import { of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

function makeContext(method: string, url: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, url }),
    }),
  } as any;
}

function makeHandler(value: unknown) {
  return { handle: () => of(value) } as any;
}

describe('ResponseInterceptor', () => {
  let interceptor: ResponseInterceptor;

  beforeEach(() => {
    interceptor = new ResponseInterceptor();
  });

  it('passes the response value through unchanged', (done) => {
    const ctx = makeContext('GET', '/api/test');
    interceptor.intercept(ctx, makeHandler({ id: 1 })).subscribe({
      next: (value) => {
        expect(value).toEqual({ id: 1 });
        done();
      },
    });
  });

  it('logs method, url, and duration after emission', (done) => {
    const ctx = makeContext('POST', '/api/items');
    const logSpy = jest.spyOn((interceptor as any).logger, 'log').mockImplementation(() => {});

    interceptor.intercept(ctx, makeHandler(null)).subscribe({
      complete: () => {
        expect(logSpy).toHaveBeenCalledWith(
          expect.stringMatching(/^POST \/api\/items — \d+ms$/),
        );
        done();
      },
    });
  });
});
