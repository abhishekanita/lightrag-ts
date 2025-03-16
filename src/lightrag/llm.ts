/**
 * LLM model interfaces and classes for LightRAG
 */

/**
 * Interface for a language model configuration
 *
 * This model is used to define a custom language model with its generation function
 * and associated parameters.
 */
export interface Model {
	/**
	 * A function that generates the response from the language model.
	 * The function should take a prompt and return a string response.
	 */
	gen_func: (...args: any[]) => Promise<string>;

	/**
	 * A dictionary that contains the arguments to pass to the callable function.
	 * This could include parameters such as the model name, API key, etc.
	 */
	kwargs: Record<string, any>;
}

/**
 * Distributes the load across multiple language models
 *
 * Useful for circumventing low rate limits with certain API providers,
 * especially on free tiers. Could also be used for splitting across
 * different models or providers.
 *
 * @example
 * ```typescript
 * const models = [
 *   { gen_func: openai_complete_if_cache, kwargs: { model: "gpt-4", api_key: process.env.OPENAI_API_KEY_1 } },
 *   { gen_func: openai_complete_if_cache, kwargs: { model: "gpt-4", api_key: process.env.OPENAI_API_KEY_2 } },
 *   { gen_func: openai_complete_if_cache, kwargs: { model: "gpt-4", api_key: process.env.OPENAI_API_KEY_3 } },
 *   { gen_func: openai_complete_if_cache, kwargs: { model: "gpt-4", api_key: process.env.OPENAI_API_KEY_4 } },
 *   { gen_func: openai_complete_if_cache, kwargs: { model: "gpt-4", api_key: process.env.OPENAI_API_KEY_5 } },
 * ];
 * const multiModel = new MultiModel(models);
 * const rag = new LightRAG({
 *   llm_model_func: multiModel.llm_model_func.bind(multiModel),
 *   // ...other args
 * });
 * ```
 */
export class MultiModel {
	private _models: Model[];
	private _current_model: number;

	/**
	 * Create a new MultiModel instance
	 * @param models List of language models to be used
	 */
	constructor(models: Model[]) {
		this._models = models;
		this._current_model = 0;
	}

	/**
	 * Get the next model in the rotation
	 * @returns The next model to use
	 */
	private _nextModel(): Model {
		this._current_model = (this._current_model + 1) % this._models.length;
		return this._models[this._current_model];
	}

	/**
	 * Generate a response using the next model in the rotation
	 *
	 * @param prompt The prompt to generate a response for
	 * @param system_prompt Optional system prompt for models that support it
	 * @param history_messages Optional conversation history for models that support it
	 * @param kwargs Additional keyword arguments to pass to the model
	 * @returns Generated response
	 */
	async llm_model_func(
		prompt: string,
		system_prompt: string | null = null,
		history_messages: Array<Record<string, any>> = [],
		...kwargs: any[]
	): Promise<string> {
		// Convert kwargs to an object if they're passed individually
		const kwObj: Record<string, any> =
			kwargs.length === 1 && typeof kwargs[0] === 'object'
				? { ...kwargs[0] }
				: {};

		// Remove specific properties we don't want to pass to the model function
		delete kwObj.model; // Stop from overwriting the custom model name
		delete kwObj.keyword_extraction;
		delete kwObj.mode;

		const nextModel = this._nextModel();

		// Combine all arguments
		const args = {
			prompt,
			system_prompt,
			history_messages,
			...kwObj,
			...nextModel.kwargs,
		};

		return await nextModel.gen_func(args);
	}
}
