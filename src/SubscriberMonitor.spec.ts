import { interval, of } from "rxjs";
import { SubscriberMonitor } from "./SubscriberMonitor";

describe("SubscriberMonitor", () => {
  it("calls subscribe callback for every subscriber on a live observable", () => {
    const subscriberCb = jasmine.createSpy("subscribeCallBack");
    const unsubscriberCb = jasmine.createSpy("unsubscribeCallBack");
    const pipe = new SubscriberMonitor(interval(500), subscriberCb, unsubscriberCb);

    pipe.subscribe();
    expect(subscriberCb).toHaveBeenCalledWith(1);
    expect(unsubscriberCb).not.toHaveBeenCalled();
    pipe.subscribe();
    expect(subscriberCb).toHaveBeenCalledWith(2);
  });

  // This is not testing a feature but rather documenting a known behaviour of rxjs
  it(`calls subscribe callback and then immediately calls
      unsubscribe for every subscriber on a completed observable`, () => {
    const subscriberCb = jasmine.createSpy("subscribeCallBack");
    const unsubscriberCb = jasmine.createSpy("unsubscribeCallBack");
    const completedOb = of(undefined);
    const pipe = new SubscriberMonitor(completedOb, subscriberCb, unsubscriberCb);

    pipe.subscribe();
    expect(subscriberCb).toHaveBeenCalledWith(1);
    expect(unsubscriberCb).toHaveBeenCalledWith(0);
    pipe.subscribe();
    expect(subscriberCb).toHaveBeenCalledWith(1);
    expect(unsubscriberCb).toHaveBeenCalledWith(0);
  });

  it("calls unsubscribe callback for every unsubscriber on a live observable", () => {
    const subscriberCb = jasmine.createSpy("subscribeCallBack");
    const unsubscriberCb = jasmine.createSpy("unsubscribeCallBack");
    const pipe = new SubscriberMonitor(interval(500), subscriberCb, unsubscriberCb);

    const sub1 = pipe.subscribe();
    expect(subscriberCb).toHaveBeenCalledWith(1);
    expect(unsubscriberCb).not.toHaveBeenCalledWith(0);
    const sub2 = pipe.subscribe();
    expect(subscriberCb).toHaveBeenCalledWith(2);
    sub1.unsubscribe();
    expect(unsubscriberCb).toHaveBeenCalledWith(1);
    sub2.unsubscribe();
    expect(unsubscriberCb).toHaveBeenCalledWith(0);
  });
});
