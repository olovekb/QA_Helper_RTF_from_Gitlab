import axios from 'axios';

const DEFAULT_SERVICE_URL = process.env.BERT_SCORE_SERVICE_URL || 'http://bert-score-service:8000';
const DEFAULT_MODEL_TYPE = process.env.BERT_SCORE_MODEL_TYPE || 'bert-base-multilingual-cased';
const DEFAULT_BATCH_SIZE = Number(process.env.BERT_SCORE_BATCH_SIZE || 8);
const DEFAULT_TIMEOUT_MS = Number(process.env.BERT_SCORE_TIMEOUT_MS || 10 * 60 * 1000);

export async function scoreTextPairs(pairs, options = {}) {
    const normalizedPairs = Array.isArray(pairs)
        ? pairs
            .map((pair, index) => ({
                pairId: pair?.pairId ?? index,
                candidate: String(pair?.candidate || ''),
                reference: String(pair?.reference || '')
            }))
            .filter((pair) => pair.candidate || pair.reference)
        : [];

    if (normalizedPairs.length === 0) {
        return [];
    }

    const response = await axios.post(
        `${options.serviceUrl || DEFAULT_SERVICE_URL}/score-pairs`,
        {
            pairs: normalizedPairs,
            lang: options.lang || 'ru',
            modelType: options.modelType || DEFAULT_MODEL_TYPE,
            batchSize: options.batchSize || DEFAULT_BATCH_SIZE,
            rescaleWithBaseline: options.rescaleWithBaseline !== false
        },
        {
            timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS
        }
    );

    const scores = Array.isArray(response?.data?.scores) ? response.data.scores : null;
    if (!scores) {
        throw new Error('BERTScore service returned an invalid response');
    }

    return scores.map((entry) => ({
        pairId: entry.pairId,
        precision: Number(entry.precision || 0),
        recall: Number(entry.recall || 0),
        f1: Number(entry.f1 || 0)
    }));
}
