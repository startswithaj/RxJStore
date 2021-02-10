import { combineLatest, Observable, of, ReplaySubject } from "rxjs";

import {
  catchError,
  distinctUntilKeyChanged,
  flatMap,
  map,
  pairwise,
  shareReplay,
  startWith,
  switchMap,
} from "rxjs/operators";

import { nodeObjectSorter } from "./NodeObjectSorter";
import { SubscriberMonitor } from "./SubscriberMonitor";

interface IRxStoreMap<T, Params, TError> {
  [id: string]: {
    observable: Observable<IRxStore<T, TError>>;
    updateValueRS: ReplaySubject<IRxStore<T, TError>>;
    lastFetchFailed: boolean;
    params: Params;
    clearFromStorageTimer?: ReturnType<typeof setTimeout>;
  };
}

export interface IRxStore<T, TError> {
  loading: boolean;
  value: undefined | T;
  error?: TError;
}

export interface IRxStores<T, TError> {
  loading: boolean;
  value: T[];
  error: TError[];
}

export interface IRxStoreOptions<Extra> {
  force?: boolean;
  extra?: Extra;
}

export type TFetcherWithAnExtra<T, Params, Extra> = (
  params: Params,
  extra?: Extra,
) => Observable<T>;
export type TFetcher<T, Params> = (params: Params) => Observable<T>;
export type TParamHasher<Params> = (params: Params) => string;

export class RxStore<T, Params, Extra = void, TError = Error> {
  protected store: IRxStoreMap<T, Params, TError> = {};

  constructor(
    private readonly fetcher:
      | TFetcher<T, Params>
      | TFetcherWithAnExtra<T, Params, Extra>,
    protected readonly errorParserLogger: (err: Error) => TError,
    private deleteFromCacheTimeMS?: number,
    private paramHasher: TParamHasher<Params> = nodeObjectSorter,
  ) { }

  public getStore(
    params: Params,
    options: IRxStoreOptions<Extra> = { force: false },
  ): Observable<IRxStore<T, TError>> {
    return this._getStore(params, options);
  }

  public getStores(
    params: Params[],
    options: IRxStoreOptions<Extra> = { force: false },
  ): Observable<IRxStores<T, TError>> {
    if (!params.length) {
      return of({ loading: false, value: [], error: [] });
    }
    return combineLatest(
      params.map((param) => this._getStore(param, options)),
    ).pipe(
      map((storeOutput) => {
        const anyLoading = storeOutput
          .map((store) => store.loading)
          .some((loading) => loading === true);
        const values = storeOutput.map((store) => store.value).filter(Boolean);
        const errors = storeOutput.map((store) => store.error).filter(Boolean);
        return { loading: anyLoading, value: values, error: errors };
      }),
      distinctUntilKeyChanged("loading"),
    );
  }

  public updateStoreValue(params: Params, value: T): void {
    this.init(params);
    this.store[this.getKey(params)].updateValueRS.next({
      error: undefined,
      loading: false,
      value,
    });
  }

  public expireAll(): void {
    Object.keys(this.store).forEach((key) => {
      this.expireKey(key);
    });
  }

  public expireWhere(predicate: (params: Params) => boolean): void {
    Object.keys(this.store).forEach((key) => {
      const matches = predicate(this.store[key].params);
      if (matches) {
        this.expireKey(key);
      }
    });
  }

  private _getStore(
    params: Params,
    options: IRxStoreOptions<Extra> = { force: false },
  ): Observable<IRxStore<T, TError>> {
    this.init(params, options.extra);
    const key = this.getKey(params);

    if (options.force || this.store[key].lastFetchFailed) {
      this.store[key].updateValueRS.next(undefined);
    }

    return this.store[key].observable;
  }

  private expireKey(key: string): void {
    this.store[key].updateValueRS.next(undefined);
  }

  private getKey(params: Params): string {
    return this.paramHasher(params);
  }

  private init(params: Params, extra?: Extra): void {
    const key = this.getKey(params);
    if (this.store[key]) {
      return;
    }
    const updateValueRS = new ReplaySubject<IRxStore<T, TError>>(1);
    const networkFetchOb = new Observable<Observable<IRxStore<T, TError>>>(
      (observer) => {
        const store = this.store[key];
        // N.B It's not guaranteed that the subscriber will receive the below value (loading: true)
        // If the fetcher executes synchronously the store will only emit the most recent value
        // to the subscriber. Meaning this value is skipped.
        observer.next(of({ loading: true, value: undefined }));
        observer.next(
          this.fetcher(params, extra).pipe(
            map((value) => {
              return { value, loading: false };
            }),
            catchError((err: Error) => {
              const error = this.errorParserLogger(err);
              store.lastFetchFailed = true;
              return of({ value: undefined, loading: false, error });
            }),
          ),
        );
      },
    ).pipe(flatMap((x) => x));
    // If someone wants to update the currentValue with a local value (i.e the returned result of a push) we call
    // next on the updateValueRS.
    // If someone wants to refetch from the network they just call updateValueRS.next(undefined)
    // which is what `expireKey` does
    updateValueRS.next(undefined);
    const networkFetchObWithRefetch: Observable<IRxStore<
      T,
      TError
    >> = updateValueRS.pipe(
      switchMap((val) => {
        if (val) {
          return of(val);
        } else {
          return networkFetchOb;
        }
      }),
    );

    const observable: Observable<IRxStore<
      T,
      TError
    >> = networkFetchObWithRefetch.pipe(
      // We always emit the previous value `stored` until its updated
      // The fetcher has no concept of the previous value `stored` so we merge
      // the old value until a new value replaces it using pairwise.
      // The pairwise requires an initial `previous` value before it kicks things off
      startWith(undefined),
      pairwise(),
      map(([previousValue, newValue]) => {
        return {
          loading: newValue.loading,
          value:
            (newValue && newValue.value) ||
            (previousValue && previousValue.value),
          ...(newValue.error ? { error: newValue.error } : undefined),
        };
      }),
      // This stops new subscribers re-triggering the whole stream and provides late subscribers the last value
      // tslint:disable-next-line
      shareReplay(1)
    );

    // If deleting from cache is enable we need to monitor the streams subscribers
    const subscriberCountedStore = this.deleteFromCacheTimeMS
      ? new SubscriberMonitor(
        observable,
        // Cancel the timeout when there is any subscriber
        (_) => clearTimeout(this.store[key].clearFromStorageTimer),
        // Trigger the deletion of the key after the timeout
        (subCount) => {
          if (subCount === 0) {
            this.store[key].clearFromStorageTimer = setTimeout(() => {
              delete this.store[key];
            }, this.deleteFromCacheTimeMS);
          }
        },
      )
      : observable;

    this.store[key] = {
      clearFromStorageTimer: undefined,
      lastFetchFailed: false,
      observable: subscriberCountedStore,
      params,
      updateValueRS,
    };
  }
}
