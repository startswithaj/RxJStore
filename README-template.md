![Lines](#lines# "Make me better!") ![BuildStatus](#buildstatus# "Building Status")


# RxJStore

A lightweight tool for caching, batching and interface unification in the spirit of RxJS.

## What does it do?

RxJStore exists as a wrapper for RxJS that allows you to cache network or computationally expensive operations quickly and easily while exposing a common interface that allows the consumer access to `loading`, `value` and `error` states in a consistent way. It also has the capacity to introduce seamless batching - allowing multiple components/consumers to request the same or disparate items - the requests are de-duplicated, batched, calculated/fetched and the underlying subscribers are notified of the results for their respective requests.

## When would I use it?

If you have an established application

- That heavily uses RxJS but has no state management framework
- And you want to transition to a more uniform approach to data access, batching and caching.

The inspiration for this was an existing Ngx application whose client side network layer was generated; it returned fetch operations wrapped as RxJS observables. This application had fragmented error/null/loading handling, and heavy batching & caching requirements. This tool allowed an iterative transition to a more uniform consumption, caching and batching pattern, without overhauling the code base.

If you have a new project that uses RxJs and could use nice clean access to:

- A generic caching mechanism
- A uniform response structure that exposes easy access to the value, loading and error states.
- Easy batching
- Simple de-duplication of requests and a guarantee that all subscribers (with the same request) share the same value.

## How

## Operators

In the spirit of RxJS, RxJStore comes with several useful operators that help with interacting with the store.

```
export const storeFilterOutLoading = <T extends IHasLoading>(source: Observable<T>) =>
  source.pipe(filter(store => !store.loading));

export const storeMapToLoading = (source: Observable<IHasLoading>) => source.pipe(map(store => store.loading));

export const storeMapToValue: TStoreMapToValue = <T>(source: Observable<IHasValue<T>>): Observable<T> =>
  source.pipe(map(store => store.value));

export const storeMapToError: TStoreMapToError = <T>(source: Observable<IMaybeHasError<T>>): Observable<T> =>
  source.pipe(map(store => store.error));
```

## Expiring a cached value

You can expire all values within a store by calling `.expireAll()`. To selectively expire some values you can use `.expireWhere(selector)` function.
`expireWhere` calls the `selector` for each request the store has cached - passing it the request parameters - if the selector returns true the value is marked as expired. If there is a live subscriber the value will be automatically refreshed/re-fetched, if there is no live subscribers nothing will happen until the next subscription where the value will be refreshed/re-fetched.

## Removing from the cache

The `deleteFromCacheTimeMS` parameter is used to remove `dead` observables - observables that don't have any live subscribers - thus freeing up memory. It does not currently expire the value within the cached Observable.
If there is a current subscription to a cached object the it won't be expired until there are no subscribers. The reason for this is that if the observable holding the value is purged from the store while there is a live subscriber and then another request comes in for that same subscription the older subscriber wont be updated with the new value fetched by the newer subscriber.

## What happens if my fetcher returns a live stream?

RxJStore will operate as expected passing through new values as their emitted by the live stream. The loading state will only change during the initialisation of the live stream.

## Custom Base Store

You may want to standardise the store for your use case. For instance you may want standardise the parsing of errors across a set of your stores so that the consumer is always dealing with a `string` or you may want to expect a consistent `extra` parameter in your fetchers. For instance in the application that inspired this tool there was a http interceptor that would intercept all network requests and show a global loader. To be able to transition away from this - an extra parameter was added to all the requests to inform the interceptor which type of loader to show (or not) and allow an iterative approach to transitioning away from the global loader to more localised/lower level loading state management.

```


// Special error object parser
import { ErrorParser } from '../util/error-parser';

// Custom `extra` type
export enum CustomLoaders {
  Global = 'Global',
  Sub = 'Sub',
  None = 'None',
}

// Now we have a CustomBaseStore that only requires a fetcher be passed in - no other configuration
// This can be used as the basis for all our other stores
export class CustomBaseStore<T, Params> extends RxStore<T, Params, CustomLoaders, string> {
  constructor(
    fetcher: TFetcherWithAnExtra<T, Params, CitrusLoaders>,
  ) {
    super(
      fetcher,
      err => ErrorParser.getErrMsg(err),
      60 * 5 // 5 minute expiry
    );
  }

  getStore(params: Params, options: IGetStoreOptions = { force: false, loader: CustomLoaders.Global }) {
    return super.getStore(params, { force: options.force, extra: options.loader });
  }

  getStores(params: Params[], options: IGetStoreOptions = { force: false, loader: CustomLoaders.Global }) {
    return super.getStores(params, { force: options.force, extra: options.loader });
  }
}

```
