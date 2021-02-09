import { Observable, of, throwError } from "rxjs";
import { delay, take, toArray } from "rxjs/operators";
import { RxStore, TFetcher } from "./RxStore";

interface ITestObj {
  test: string;
}

class TestStore extends RxStore<ITestObj, string> {
  constructor(fetcher: TFetcher<ITestObj, string>, deleteFromCacheTimeMS?: number) {
    super(fetcher, () => void 0, deleteFromCacheTimeMS);
  }

  public accessStore() {
    return this.store;
  }
}

const toDelayedOb = (val) => of(val).pipe(delay(100));

describe("RxStore", () => {
  const TEST_PARAM = "TEST";
  const TEST_RESULT = { test: "TEST_STRING" };

  let rxStore: TestStore;
  let mockFetcher: TFetcher<ITestObj, string>;

  describe("getStore", () => {
    beforeEach(() => {
      mockFetcher = jasmine.createSpy().and.returnValue(toDelayedOb(TEST_RESULT));
      rxStore = new TestStore(mockFetcher);
    });

    it("returns observable", () => {
      expect(rxStore.getStore(TEST_PARAM)).toEqual(jasmine.any(Observable));
    });

    it("subsequent calls to getStore return same observable", () => {
      const ret1 = rxStore.getStore(TEST_PARAM);
      const ret2 = rxStore.getStore(TEST_PARAM);
      expect(ret1).toBe(ret2);
    });

    it("subsequent subscriptions to getStore do not trigger fetch ", () => {
      rxStore.getStore(TEST_PARAM).subscribe();
      rxStore.getStore(TEST_PARAM).subscribe();
      expect(mockFetcher).toHaveBeenCalledTimes(1);
    });

    it("subsequent subscriptions to getStore with force === true do trigger fetch ", () => {
      rxStore.getStore(TEST_PARAM).subscribe();
      rxStore.getStore(TEST_PARAM, { force: true }).subscribe();
      expect(mockFetcher).toHaveBeenCalledTimes(2);
    });

    it("subsequent subscriptions to getStore when previous fetch fails do trigger fetch ", () => {
      mockFetcher = jasmine.createSpy().and.returnValue(throwError("This is an error!"));
      rxStore = new TestStore(mockFetcher);
      rxStore.getStore(TEST_PARAM).subscribe();
      rxStore.getStore(TEST_PARAM).subscribe();
      expect(mockFetcher).toHaveBeenCalledTimes(2);
    });

    it("emits expected values", async () => {
      const expectedValues = [
        { loading: true, value: undefined },
        { loading: false, value: TEST_RESULT },
      ];
      const emittedValues = await rxStore
        .getStore(TEST_PARAM)
        .pipe(take(2), toArray())
        .toPromise();
      expect(emittedValues).toEqual(expectedValues);
    });

    it("emits locally updated value when set", async () => {
      const LOCAL_TEST_RESULT = { test: "LOCAL_TEST_STRING" };
      rxStore.updateStoreValue(TEST_PARAM, LOCAL_TEST_RESULT);
      const expectedValues = [{ loading: false, value: LOCAL_TEST_RESULT }];
      const emittedValues = await rxStore
        .getStore(TEST_PARAM)
        .pipe(take(1), toArray())
        .toPromise();
      expect(emittedValues).toEqual(expectedValues);
    });

    it("emits network and then updated value", async () => {
      const LOCAL_TEST_RESULT = { test: "LOCAL_TEST_STRING" };
      const expectedFirstValues = [
        { loading: true, value: undefined },
        { loading: false, value: TEST_RESULT },
      ];
      const expectedSecondValues = [{ loading: false, value: LOCAL_TEST_RESULT }];
      const store = rxStore.getStore(TEST_PARAM);
      const emittedValues = await store.pipe(take(2), toArray()).toPromise();
      expect(emittedValues).toEqual(expectedFirstValues);

      rxStore.updateStoreValue(TEST_PARAM, LOCAL_TEST_RESULT);

      const emittedValues2 = await store.pipe(take(1), toArray()).toPromise();
      expect(emittedValues2).toEqual(expectedSecondValues);
    });

    it("emits locally updated value when set, and refetches when forced", async () => {
      const LOCAL_TEST_RESULT = { test: "LOCAL_TEST_STRING" };
      rxStore.updateStoreValue(TEST_PARAM, LOCAL_TEST_RESULT);
      const expectedValues = [{ loading: false, value: LOCAL_TEST_RESULT }];
      const emittedValues = await rxStore
        .getStore(TEST_PARAM)
        .pipe(take(1), toArray())
        .toPromise();
      expect(emittedValues).toEqual(expectedValues);
      rxStore.getStore(TEST_PARAM, { force: true });

      const expectedSecondValues = [
        { loading: true, value: LOCAL_TEST_RESULT },
        { loading: false, value: TEST_RESULT },
      ];
      const store = rxStore.getStore(TEST_PARAM);
      const emittedValues2 = await store.pipe(take(2), toArray()).toPromise();
      expect(emittedValues2).toEqual(expectedSecondValues);
    });

    it("respects deleteFromCacheTimeMS and deletes observable from cache", async () => {
      const deleteFromCacheTimeMS = 200;
      rxStore = new TestStore(mockFetcher, deleteFromCacheTimeMS);
      const store1 = rxStore.getStore(TEST_PARAM);
      const sub = store1.subscribe();
      sub.unsubscribe();
      const store2 = rxStore.getStore(TEST_PARAM);
      expect(store1).toEqual(store2);
      expect(Object.keys(rxStore.accessStore()).length).toEqual(1);
      await of(undefined)
        .pipe(delay(deleteFromCacheTimeMS))
        .toPromise();
      expect(Object.keys(rxStore.accessStore()).length).toEqual(0);
    });

    it("respects unset deleteFromCacheTimeMS and does not remove observable from cache", async () => {
      const deleteFromCacheTimeMS = undefined;
      rxStore = new TestStore(mockFetcher, deleteFromCacheTimeMS);
      const store1 = rxStore.getStore(TEST_PARAM);
      const sub = store1.subscribe();
      sub.unsubscribe();
      const store2 = rxStore.getStore(TEST_PARAM);
      expect(store1).toEqual(store2);
      expect(Object.keys(rxStore.accessStore()).length).toEqual(1);
      await of(undefined)
        .pipe(delay(200))
        .toPromise();
      expect(Object.keys(rxStore.accessStore()).length).toEqual(1);
    });
  });
});
