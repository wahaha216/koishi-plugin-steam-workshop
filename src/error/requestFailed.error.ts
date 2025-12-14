export class RequestFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestFailedError";
  }
}
