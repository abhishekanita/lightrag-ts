export const config = {
	mongo: {
		uri: process.env.MONGO_URI,
		database: process.env.MONGO_DB,
	},

	openaiApiKey: process.env.OPENAI_API_KEY,
};
