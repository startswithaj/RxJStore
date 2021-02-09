import { Observable, Subscriber } from "rxjs";

export class SubscriberMonitor<T> extends Observable<T> {
  private counter = 0;
  constructor(
    observable: Observable<T>,
    onSubscribe: (subscriberCount: number) => void,
    onUnsubscribe: (subscriberCount: number) => void,
  ) {
    super((subscriber: Subscriber<T>) => {
      const subscription = observable.subscribe(subscriber);
      this.counter++;
      onSubscribe(this.counter);

      return () => {
        subscription.unsubscribe();
        this.counter--;
        onUnsubscribe(this.counter);
      };
    });
  }
}
