// eslint-disable-next-line @typescript-eslint/ban-types
export function optionalRequire(packageName: string, loaderFn?: Function) {
  try {
    return loaderFn ? loaderFn() : require(packageName);
  } catch (e) {
    return {};
  }
}
