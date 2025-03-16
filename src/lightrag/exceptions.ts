export class APIStatusError extends Error {
	response: any;
	status_code: number;
	request_id: string | null;

	constructor(message: string, response: any, body: any | null) {
		super(message);
		this.name = 'APIStatusError';
		this.response = response;
		this.status_code = response.status;
		this.request_id = (response.headers['x-request-id'] as string) || null;

		// This line is needed for TypeScript to correctly maintain the prototype chain
		Object.setPrototypeOf(this, APIStatusError.prototype);
	}
}

export class APIConnectionError extends Error {
	request: any;

	constructor({
		message = 'Connection error.',
		request,
	}: {
		message?: string;
		request?: any;
	}) {
		super(message);
		this.name = 'APIConnectionError';
		this.request = request;

		// This line is needed for TypeScript to correctly maintain the prototype chain
		Object.setPrototypeOf(this, APIConnectionError.prototype);
	}
}

export class BadRequestError extends APIStatusError {
	status_code = 400;
}

export class AuthenticationError extends APIStatusError {
	status_code = 401;
}

export class PermissionDeniedError extends APIStatusError {
	status_code = 403;
}

export class NotFoundError extends APIStatusError {
	status_code = 404;
}

export class ConflictError extends APIStatusError {
	status_code = 409;
}

export class UnprocessableEntityError extends APIStatusError {
	status_code = 422;
}

export class RateLimitError extends APIStatusError {
	status_code = 429;
}

export class APITimeoutError extends APIConnectionError {
	constructor(request: any) {
		super({ message: 'Request timed out.', request });
		this.name = 'APITimeoutError';

		// This line is needed for TypeScript to correctly maintain the prototype chain
		Object.setPrototypeOf(this, APITimeoutError.prototype);
	}
}
