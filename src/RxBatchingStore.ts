import { Dictionary, keyBy, uniqBy } from "lodash";
import { Observable, of, Subject, throwError } from "rxjs";
import { bufferTime, first, map, share, shareReplay, switchMap } from "rxjs/operators";
import { nodeObjectSorter } from "./NodeObjectSorter";
import { RxStore } from "./RxStore";

export interface IRxBatchSingleResponse<TResponse, TRequest> {
  response: TResponse;
  request: TRequest;
  error?: Error;
}

interface IRequestWithExtra<TRequest, Extra> {
  request: TRequest;
  extra?: Extra;
}

interface IBatchEvent<TResponse, TRequest> {
  requestHashes: Set<string>;
  responsesOb: Observable<Dictionary<IRxBatchSingleResponse<TResponse, TRequest>>>;
}

export type RxBatchFetchingFunction<TResponse, TRequest, Extra = void> = (
  req: Array<IRequestWithExtra<TRequest, Extra>>,
) => Observable<Array<IRxBatchSingleResponse<TResponse, TRequest>>>;

// Some of the code in this file is borrowed from the user Marc https://stackoverflow.com/a/57401289
export class RxBatchingStore<TResponse, TRequest, Extra = void, TError = string> extends RxStore<
  TResponse,
  TRequest,
  Extra,
  TError
  > {
  private requestSubject = new Subject<IRequestWithExtra<TRequest, Extra>>();

  private requests: Observable<IBatchEvent<TResponse, TRequest>> = this.requestSubject.asObservable().pipe(
    bufferTime(this.bufferTimeMS),
    map((requests) => this.fetchBatch(requests)),
    share(),
  );

  constructor(
    private readonly batchFetchingFunction: RxBatchFetchingFunction<TResponse, TRequest, Extra>,
    errorParserLogger: (err: Error) => TError,
    private readonly bufferTimeMS = 100,
  ) {
    super((req, extra) => this.fetch(req, extra), errorParserLogger);
  }

  private fetch(request: TRequest, extra?: Extra): Observable<TResponse> {
    const observable = new Observable<IBatchEvent<TResponse, TRequest>>((observer) => {
      this.requests.subscribe(observer);
      // Emit *after* the subscription
      this.requestSubject.next(extra ? { request, extra } : { request });
    });
    const requestHash = nodeObjectSorter(request);
    return observable.pipe(
      // This could be `filter` - this would then alert any downstream observables
      // That included this `request` in any future batches
      // As all requests to this.fetch are proxied through rxStore.getStore and are single requests anyway,
      // the observable store in rxStore would be switched to listen to the new batch anyway
      // If the `batchFetchingFunction` returns a stream, this `first` does not prevent
      // downstream from receiving new values emitted on the stream that's returned by `batchFetchingFunction`
      first((batchEvent) => batchEvent.requestHashes.has(requestHash)),
      switchMap((batchEvent) => batchEvent.responsesOb),
      map((responsesDictionary) => responsesDictionary[requestHash]),
      switchMap((v) => {
        if (v) {
          if (v.error) {
            return throwError(v.error);
          }
          return of(v.response);
        }
        // In the case were no value is returned for a request hash we emit undefined.
        // This is much easier to debug than the stream not emitting at all. Trust.
        return of(undefined);
      }),
    );
  }

  private fetchBatch(reqs: Array<IRequestWithExtra<TRequest, Extra>>): IBatchEvent<TResponse, TRequest> {
    const uniqRequests = uniqBy(reqs, (req) => nodeObjectSorter(req.request));
    const responsesOb = this.batchFetchingFunction(uniqRequests).pipe(
      map((results) => keyBy(results, (result) => nodeObjectSorter(result.request))),
      // tslint:disable-next-line:all
      shareReplay({ refCount: true, bufferSize: 1 })
    );
    return { requestHashes: new Set(reqs.map((req) => nodeObjectSorter(req.request))), responsesOb };
  }
}
