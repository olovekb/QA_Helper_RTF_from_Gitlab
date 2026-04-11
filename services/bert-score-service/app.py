import os
from typing import List, Optional, Union

import torch
from bert_score import score as bert_score
from fastapi import FastAPI
from pydantic import BaseModel, Field


class ScorePair(BaseModel):
    pairId: Optional[Union[str, int]] = None
    candidate: str = ''
    reference: str = ''


class ScoreRequest(BaseModel):
    pairs: List[ScorePair] = Field(default_factory=list)
    lang: str = 'ru'
    modelType: Optional[str] = None
    batchSize: int = 8
    rescaleWithBaseline: bool = True


MODEL_TYPE = os.getenv('BERT_SCORE_MODEL_TYPE', 'bert-base-multilingual-cased')
DEVICE = os.getenv('BERT_SCORE_DEVICE') or ('cuda' if torch.cuda.is_available() else 'cpu')

app = FastAPI(title='BERTScore Service')


@app.get('/health')
def health():
    return {
        'status': 'ok',
        'device': DEVICE,
        'modelType': MODEL_TYPE
    }


@app.post('/score-pairs')
def score_pairs(payload: ScoreRequest):
    if not payload.pairs:
        return {
            'modelType': payload.modelType or MODEL_TYPE,
            'device': DEVICE,
            'scores': []
        }

    candidates = [pair.candidate or '' for pair in payload.pairs]
    references = [pair.reference or '' for pair in payload.pairs]

    precision, recall, f1 = bert_score(
        candidates,
        references,
        lang=payload.lang,
        model_type=payload.modelType or MODEL_TYPE,
        device=DEVICE,
        batch_size=max(1, payload.batchSize),
        rescale_with_baseline=payload.rescaleWithBaseline,
        verbose=False
    )

    return {
        'modelType': payload.modelType or MODEL_TYPE,
        'device': DEVICE,
        'scores': [
            {
                'pairId': payload.pairs[index].pairId if payload.pairs[index].pairId is not None else index,
                'precision': float(precision[index].item()),
                'recall': float(recall[index].item()),
                'f1': float(f1[index].item())
            }
            for index in range(len(payload.pairs))
        ]
    }
