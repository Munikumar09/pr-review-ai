import * as vscode from 'vscode';

export class OperationCancelledError extends Error {
  constructor() {
    super('Operation cancelled');
    this.name = 'OperationCancelledError';
  }
}

export function throwIfCancelled(token?: vscode.CancellationToken): void {
  if (token?.isCancellationRequested) {
    throw new OperationCancelledError();
  }
}

/** Rejects with OperationCancelledError as soon as the token is cancelled, whichever comes first against `promise`. */
export function raceCancellation<T>(
  promise: Promise<T>,
  token?: vscode.CancellationToken,
): Promise<T> {
  if (!token) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const subscription = token.onCancellationRequested(() => {
      reject(new OperationCancelledError());
    });
    promise.then(
      (value) => {
        subscription.dispose();
        resolve(value);
      },
      (err) => {
        subscription.dispose();
        reject(err);
      },
    );
  });
}
