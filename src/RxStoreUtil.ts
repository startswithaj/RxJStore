import { Observable } from "rxjs";
import { filter, map } from "rxjs/operators";

interface IHasLoading {
  loading: boolean;
}

interface IHasValue<T> {
  value: T;
}
interface IMaybeHasError<T> {
  error?: T;
}

type TStoreMapToValue = <T>(source: Observable<IHasValue<T>>) => Observable<T>;
type TStoreMapToError = <T>(
  source: Observable<IMaybeHasError<T>>,
) => Observable<T>;

export const storeFilterOutLoading = <T extends IHasLoading>(
  source: Observable<T>,
) => source.pipe(filter((store) => !store.loading));

export const storeMapToLoading = (source: Observable<IHasLoading>) =>
  source.pipe(map((store) => store.loading));

export const storeMapToValue: TStoreMapToValue = <T>(
  source: Observable<IHasValue<T>>,
): Observable<T> => source.pipe(map((store) => store.value));

export const storeMapToError: TStoreMapToError = <T>(
  source: Observable<IMaybeHasError<T>>,
): Observable<T> => source.pipe(map((store) => store.error));
