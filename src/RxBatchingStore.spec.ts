import { from, Observable, of } from "rxjs";
import { concatMap, delay, take, toArray } from "rxjs/operators";
import { RxBatchFetchingFunction, RxBatchingStore, IRxBatchSingleResponse } from "./RxBatchingStore";
import { storeFilterOutLoading, storeMapToError, storeMapToValue } from "./RxStoreUtil";

interface ITestObj {
  test: string;
}

type TRequest = string;

type TExtra = string;

class TestStore extends RxBatchingStore<ITestObj, TRequest, TExtra> {
  constructor(
    fetcher: RxBatchFetchingFunction<ITestObj, TRequest, TExtra>,
    deleteFromCacheTimeMS?: number,
  ) {
    super(fetcher, (err) => err.message, deleteFromCacheTimeMS);
  }
}

const toDelayedOb = (val) => of(val).pipe(delay(100));

describe("RxBatchingStore", () => {
  const TEST_PARAM = "TEST";
  const TEST_PARAM2 = "TEST2";
  const TEST_RESULT = { test: "TEST_STRING" };
  const TEST_RESULT2 = { test: "TEST_STRING2" };

  let batchingStore: TestStore;
  let mockBatchFetcher: RxBatchFetchingFunction<ITestObj, TRequest, TExtra>;

  describe("getStore", () => {
    beforeEach(() => {
      const fetcherResults: IRxBatchSingleResponse<ITestObj, TRequest>[] = [
        { request: TEST_PARAM, response: TEST_RESULT },
        { request: TEST_PARAM2, response: TEST_RESULT2 },
      ];
      mockBatchFetcher = jasmine.createSpy("mockBatchFetcher").and.returnValue(toDelayedOb(fetcherResults));
      const bufferTimeMs = 1;
      batchingStore = new TestStore(mockBatchFetcher, bufferTimeMs);
    });

    it("returns observable", () => {
      expect(batchingStore.getStore(TEST_PARAM)).toEqual(jasmine.any(Observable));
    });

    it("calls fetcher after delay with request ", async () => {
      batchingStore.getStore(TEST_PARAM).subscribe();
      expect(mockBatchFetcher).not.toHaveBeenCalled();
      await of(undefined)
        .pipe(delay(2))
        .toPromise();
      expect(mockBatchFetcher).toHaveBeenCalledWith([{ request: TEST_PARAM }]);
    });

    it("calls mockBatchFetcher with both buffered requests", async () => {
      batchingStore.getStore(TEST_PARAM).subscribe();
      batchingStore.getStore(TEST_PARAM2).subscribe();
      expect(mockBatchFetcher).not.toHaveBeenCalled();
      await of(undefined)
        .pipe(delay(2))
        .toPromise();
      expect(mockBatchFetcher).toHaveBeenCalledWith([{ request: TEST_PARAM }, { request: TEST_PARAM2 }]);
    });

    it("batchFetcher is called with both request and extra (when provided)", async () => {
      batchingStore.getStore(TEST_PARAM, { extra: "ExtraParams" }).subscribe();
      expect(mockBatchFetcher).not.toHaveBeenCalled();
      await of(undefined)
        .pipe(delay(2))
        .toPromise();
      expect(mockBatchFetcher).toHaveBeenCalledWith([{ request: TEST_PARAM, extra: "ExtraParams" }]);
    });

    it("if batchFetcher returns error is promoted", async () => {
      const fetcherResults: IRxBatchSingleResponse<ITestObj, TRequest>[] = [
        { request: TEST_PARAM, error: new Error("BatchTestError"), response: undefined },
      ];

      const observableResultStream = from([fetcherResults]);

      mockBatchFetcher = jasmine.createSpy("mockBatchFetcher").and.returnValue(observableResultStream);
      const bufferTimeMs = 1;
      batchingStore = new TestStore(mockBatchFetcher, bufferTimeMs);
      const emittedValue = await batchingStore
        .getStore(TEST_PARAM)
        .pipe(storeFilterOutLoading, storeMapToError, take(1), toArray())
        .toPromise();
      expect(emittedValue).toEqual(["BatchTestError"]);
    });

    it("if batchFetcher returns no value for request, undefined is returned", async () => {
      mockBatchFetcher = jasmine.createSpy("mockBatchFetcher").and.returnValue(of([]));
      const bufferTimeMs = 1;
      batchingStore = new TestStore(mockBatchFetcher, bufferTimeMs);
      const emittedValues = await batchingStore
        .getStore(TEST_PARAM)
        .pipe(storeFilterOutLoading, storeMapToValue, take(1), toArray())
        .toPromise();
      expect(emittedValues).toEqual([undefined]);
    });

    it("if batchFetcher is live stream - downstream stays updated", async () => {
      const fetcherResults: IRxBatchSingleResponse<ITestObj, TRequest>[] = [
        { request: TEST_PARAM, response: TEST_RESULT },
      ];
      const fetcherResults2: IRxBatchSingleResponse<ITestObj, TRequest>[] = [
        { request: TEST_PARAM, response: { test: "TEST_RESULT_SECOND" } },
      ];
      const observableResultStream = from([fetcherResults, fetcherResults2]).pipe(
        concatMap((item) => of(item).pipe(delay(1000))),
      );

      mockBatchFetcher = jasmine.createSpy("mockBatchFetcher").and.returnValue(observableResultStream);
      const bufferTimeMs = 1;
      batchingStore = new TestStore(mockBatchFetcher, bufferTimeMs);
      const emittedValues2 = await batchingStore
        .getStore(TEST_PARAM)
        .pipe(storeFilterOutLoading, storeMapToValue, take(2), toArray())
        .toPromise();
      expect(emittedValues2).toEqual([TEST_RESULT, { test: "TEST_RESULT_SECOND" }]);
    });

    // The `fetchBatch` function use to return a `share()` observable
    // (now uses shareReplay({ refCount: true, bufferSize: 1 }))
    // This meant that if the BatchFetchingFunction returned a non completed stream (live stream)
    // secondary subscribers to the result of the BatchFetchingFunction would not be provided the value
    // This test run with `share()` instead of `shareReplay({ refCount: true, bufferSize: 1 })` will fail
    it("if batchFetcher returns non completed stream - emits value to all listeners", (done) => {
      const fetcherResults: IRxBatchSingleResponse<ITestObj, TRequest>[] = [
        { request: TEST_PARAM, response: TEST_RESULT },
        { request: TEST_PARAM2, response: TEST_RESULT2 },
      ];
      const observableResultStream: Observable<{ request: string; response: ITestObj }[]> = new Observable(
        (sub) => {
          sub.next(fetcherResults);
        },
      );

      mockBatchFetcher = () => observableResultStream;
      const bufferTimeMs = 1;
      batchingStore = new TestStore(mockBatchFetcher, bufferTimeMs);
      let count = 0;
      batchingStore
        .getStore(TEST_PARAM)
        .pipe(storeFilterOutLoading, storeMapToValue)
        .subscribe((param1Result) => {
          count++;
          expect(param1Result).toEqual(TEST_RESULT);
          if (count === 2) {
            done();
          }
        });

      batchingStore
        .getStore(TEST_PARAM2)
        .pipe(storeFilterOutLoading, storeMapToValue)
        .subscribe((param2Result) => {
          expect(param2Result).toEqual(TEST_RESULT2);
          count++;
          if (count === 2) {
            done();
          }
        });
    });
  });
});
