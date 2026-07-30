type AssetFetcher = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type WorkerEnvironment = {
  ASSETS: AssetFetcher;
};

const worker = {
  fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
    return environment.ASSETS.fetch(request);
  },
};

export default worker;
