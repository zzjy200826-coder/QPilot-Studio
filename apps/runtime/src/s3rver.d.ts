declare module "s3rver" {
  export default class S3rver {
    constructor(options: Record<string, unknown>);
    run(): Promise<void>;
    close(): Promise<void>;
  }
}
