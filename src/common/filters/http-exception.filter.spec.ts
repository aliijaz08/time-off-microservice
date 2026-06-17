import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function makeHost(url: string): { host: ArgumentsHost; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return {
    host: {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url }),
      }),
    } as unknown as ArgumentsHost,
    status,
    json,
  };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  it('handles HttpException with a string response', () => {
    const { host, status, json } = makeHost('/api/items');
    filter.catch(new HttpException('Resource not found', HttpStatus.NOT_FOUND), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 404,
      error: 'NOT_FOUND',
      message: 'Resource not found',
      path: '/api/items',
    }));
  });

  it('extracts message field from object response', () => {
    const { host, json } = makeHost('/api/items');
    filter.catch(new HttpException({ message: 'Validation failed' }, HttpStatus.BAD_REQUEST), host);

    const payload = json.mock.calls[0][0];
    expect(payload.statusCode).toBe(400);
    expect(payload.message).toBe('Validation failed');
  });

  it('joins array message into a comma-separated string', () => {
    const { host, json } = makeHost('/api/items');
    filter.catch(
      new HttpException({ message: ['field is required', 'must be a string'] }, HttpStatus.BAD_REQUEST),
      host,
    );

    const payload = json.mock.calls[0][0];
    expect(payload.message).toBe('field is required, must be a string');
  });

  it('falls back to error field when message is absent from object response', () => {
    const { host, json } = makeHost('/api/items');
    filter.catch(new HttpException({ error: 'CUSTOM_ERROR' }, HttpStatus.UNPROCESSABLE_ENTITY), host);

    const payload = json.mock.calls[0][0];
    expect(payload.message).toBe('CUSTOM_ERROR');
  });

  it('handles non-HttpException as 500 INTERNAL_SERVER_ERROR', () => {
    const { host, status, json } = makeHost('/api/crash');
    filter.catch(new Error('Unexpected failure'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 500,
      error: 'INTERNAL_SERVER_ERROR',
    }));
  });

  it('includes timestamp and path in every response', () => {
    const { host, json } = makeHost('/my/path');
    filter.catch(new HttpException('ok', HttpStatus.OK), host);

    const payload = json.mock.calls[0][0];
    expect(payload.path).toBe('/my/path');
    expect(typeof payload.timestamp).toBe('string');
  });
});
