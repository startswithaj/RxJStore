![Lines](https://img.shields.io/badge/Coverage-98.23%25-brightgreen.svg "Make me better!") ![BuildStatus](https://img.shields.io/badge/Build-Passing-brightgreen.svg "Building Status")


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

All stores always return `{ loading: boolean, value: T | undefined, error: undefined | TError = Error }`. They never throw. Inner properties of the store can be mapped to directly using the util operators provided.

You create a store by providing a `fetcher` function. This function is called when the value for the given parameter does not exist in the store or a re-fetch is forced.

The fetcher must only take one parameter of any type eg.
`(req: string) => Observable<Response>` || `(req: { param1: string, param2: number}) => Observable<Response>`. The fetcher must return an observable. The store infers the 1st parameters type and types the getStore function.

The fetcher will usually be a function that takes the request parameter and makes a http call, db call, or connects to a stream. It can simply be a function that does heavy computation that needs to be cached and shared as a stream.

You also provide an `errorParser` function that we be called with any runtime error that is thrown from the fetcher. What this function returns will be the value of `error` in { loading, value, error}. eg `(err) => err.message` || `(err) => err.code + ':' + err.message` || `(err) => err` (i.e a passthrough).

RxStore takes 2 other optional parameters. `deleteFromCacheTimeMS` - if this value is not set, data in the store is never removed. If this value is set the data in the store will be removed `deleteFromCacheTimeMS` once the last subscriber to that value unsubscribes. If there is a new subscriber in the meantime, this will be reset.

`paramHasher` - Because values in the store are stored against the parameter that is used to request the value, for complex parameter types we need to be able to hash the parameter. This is done automatically by the store for most complex types using `node-object-hash` but in some cases you may want to provide you own hashing function I.E you may not want all parts of a complex parameter object used in the signature/hash. in this case you can override it. In 99% of cases supply changing this default behaviour is not necessary. A `paramHasher` is a function that takes the request param and returns a string eg `(req: { param1: string, param2: number}) => JSON.Stringify(req)`.

### RxStore

```ts
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { RxStore, storeFilterOutLoading, storeMapToError, storeMapToLoading, storeMapToValue  } from "RxStore";


interface Product {
  productId: string
  imageUrl: string
  // ...etc
}

function getProduct(productId: string): Observable<Product> {
  console.log('> Calling product endpoint: ', productId)
  return httpClient.get(`https://example.com/product`, { params: {productId} });
}

const fetcher = getProduct
const errParser = (err: Error) => err.message

// Singleton
const productStore = new RxStore(fetcher, errParser);

// In component 1
const product1Store = productStore.getStore('product1');

const $loading = product1Store.pipe(storeMapToLoading); // emits true then false
const $value = product1Store.pipe(storeMapToValue); // emits undefined and then the product (once it loads)
const $valueOnly = product1Store.pipe(storeFilterOutLoading, storeMapToValue); // only emits the product (once it loads)
const $error = product1Store.pipe(storeMapToError); // emits Error if there is an error

$value.subscribe()
// '> Calling products endpoint: product1' - doesn't fetch until there is a subscriber

// In some other component or some other part of the application
const product1StoreY = productStore.getStore('product1').subscribe();
// No network call `product1` is cached`

// In some other component
const product1StoreZ = productStore.getStore('prodict1', {force: true}).subscribe();
// '> Calling products endpoint: product1'
// product is re-fetched, all subscribers of store1 and store2 are updated with re-fetched product as well

```
### RxBatchingStore

```ts
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { RxBatchFetchingFunction, RxBatchingStore } from "./RxBatchingStore";

type ProductId = string;

function getProducts(productIds: string[]): Observable<Product[]> {
  console.log('> Calling products endpoint', productIds)
  return httpClient.get(`https://example.com/products`, { params: {productIds} });
}

// RxBatchingFetcher is a function that takes an array of requests and produces an array of responses.
const fetcher: RxBatchFetchingFunction<Product, ProductId> = (requests: { request: ProductId }[]) => {
  const productIds = requests.map(r => r.request);
  const $products = getProducts(productIds);
  return $products.pipe(map(products => {
    return products.map(product => {
      // We return an array of request:response pairs
      // This allows the store to notify the respective subscriber
      return {request: product.productId, response: product}
    })
  }))
}


const productsBatchingStore = new RxBatchingStore(fetcher, err => err)

const products1StoreSub = productsBatchingStore.getStore('product1').subscribe();
const products2StoreSub = productsBatchingStore.getStore('product2').subscribe();
const products3StoreSub = productsBatchingStore.getStore('product3').subscribe();
// '> Calling products endpoint: product1, product2, product3' - one network call

productsBatchingStore.expireAll() // Forces refetch of all actively subscribed store values
// '> Calling products endpoint: product1, product2, product3' - one network call

products2StoreSub.unsubscribe()

productsBatchingStore.expireAll() // Forces refetch of all actively subscribed store values
// '> Calling products endpoint: product1, product3' - one network call


productsBatchingStore.expireWhere(productId => productId === 'product1')
// '> Calling products endpoint: product1' = products1Store is notified with new value

```

### getStores

All stores (batching and normal) have a helper method that allows the user to fetch multiple values from the store at once.
`getStores(params[])`. This returns `{ value: [], loading: boolean, error: [] }`. The loading state will remain true until all the values have been fetched, though updates are emitted as the values come in.

```ts

const productsToFetch = ['product1', 'product2', 'product3'];
const productsStore = productStore.getStores(productsToFetch);

productsStore.subscribe(store => {
  console.log('log:', store):
  // log: { loading: true, value: [], error: [] }
  // log: { loading: false, value: [{product1}, {product2}, {product}], error: [] }
})


```

## IOC/DI

RxStore is compatible with most IOC/DI frameworks. Simply create stores by extending the RxStore class and mark those classes as @Injectable(). In this case the fetcher and error handler are passed to the super constructor.

```ts

type ProductId = string;
type ErrorType = string;

@Injectable()
class ProductStore extends RxStore<Product[], ProductId, void, ErrorType> {
  constructor(productService: ProductService, errorLogger: ErrorLoggingService) {
    super(productId => productService.getProduct(productId), err => {
      errorLogger.error(err)
      return err.message;
    })
  }
}

```


## Operators

In the spirit of RxJS, RxJStore comes with several useful operators that help with interacting with the store.

```ts
// Only receive value
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

You may want to standardise the store for your use case. For instance you may want standardise the parsing of errors across a set of your stores so that the consumer is always dealing with a `string` or you may want to expect a consistent `extra` parameter in your fetchers (eg. for triggering global loading animations).
In the application that inspired this tool there was a http interceptor that would intercept all network requests and show a global loader. To be able to transition away from this - an extra parameter was added to all the requests to inform the interceptor which type of loader to show (or not) and allow an iterative approach to transitioning away from the global loader to more localised/lower level loading state management.

```ts

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
      1000 * 60 * 5 // 5 minute expiry
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
