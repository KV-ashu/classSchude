/** Awaits a promise and returns the thrown error, or undefined when it resolves. */
export async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}
