#!/usr/bin/env python3
"""
Local fallback for the genAI SEGMENTATION stage (see
backend/src/modules/genAI/services/LocalSegmentationService.ts), used when
the external AI server is unreachable.

The module's own SegmentationParameters fields (lam = penalty, runs = number
of runs, noiseId = cost/noise model) strongly suggest the real AI server
already does penalized changepoint detection over an embedding sequence, not
a black-box model — see the research this was based on:
  - BERTSeg / embedding-based TextTiling: https://arxiv.org/pdf/2106.12978
  - PELT via ruptures: https://github.com/deepcharles/ruptures

Approach:
  1. Vectorize each transcript chunk with hand-written TF-IDF (numpy only).
     A BERT-family embedding model (fastembed/onnxruntime) was tried first
     and dropped — onnxruntime (and scikit-learn, tried as a second option)
     have no prebuilt wheels for this project's Alpine/musl runtime image at
     all, confirmed by testing directly, not assumed. TF-IDF is the older,
     lower-quality method the research above explicitly contrasts against
     BERT-embeddings, but it's the one that actually installs reliably on
     both real targets (Cloud Run/Alpine and Render) without a slow,
     fragile from-source compile.
  2. Run PELT changepoint detection over the TF-IDF vector sequence with the
     requested penalty (lam) and cost model (noiseId).
  3. If runs > 1, repeat with light jitter and keep only changepoints that
     recur across a majority of runs, for stability — matching what the
     "Number of runs for segmentation" parameter implies.
  4. Map changepoint indices back to timestamps using the chunks' own
     end times, output as a sorted segmentationMap.

Input (stdin): {"chunks": [{"start": num, "end": num|null, "text": str}, ...],
                "lam": num, "runs": num, "noiseId": num}
Output (stdout): {"segmentationMap": [num, ...]} on success,
                  {"error": str} (exit code 1) on failure.
"""
import json
import re
import sys
from collections import Counter

import numpy as np
import ruptures as rpt

TOKEN_RE = re.compile(r"[a-z0-9]+")


def tokenize(text):
    return TOKEN_RE.findall(text.lower())


def tfidf_vectors(texts):
    """Plain TF-IDF, no external ML dependency: term frequency per document
    times inverse document frequency across the corpus, L2-normalized."""
    token_lists = [tokenize(t) for t in texts]
    vocab = sorted(set(tok for tokens in token_lists for tok in tokens))
    vocab_index = {tok: i for i, tok in enumerate(vocab)}
    n_docs = len(texts)

    doc_freq = np.zeros(len(vocab))
    for tokens in token_lists:
        for tok in set(tokens):
            doc_freq[vocab_index[tok]] += 1
    idf = np.log((1 + n_docs) / (1 + doc_freq)) + 1

    matrix = np.zeros((n_docs, len(vocab)))
    for row, tokens in enumerate(token_lists):
        if not tokens:
            continue
        counts = Counter(tokens)
        total = len(tokens)
        for tok, count in counts.items():
            matrix[row, vocab_index[tok]] = (count / total) * idf[vocab_index[tok]]

    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1
    return matrix / norms

NOISE_MODELS = {0: "l2", 1: "rbf", 2: "normal"}
DEFAULT_LAM = 2.0
DEFAULT_RUNS = 1
JITTER_STD = 0.01


def cost_model_for(noise_id):
    if noise_id is None:
        return "l2"
    return NOISE_MODELS.get(int(noise_id), "l2")


def detect_changepoints(signal, penalty, model, runs):
    """Run PELT `runs` times (with jitter for runs > 1), return indices that
    recur across a majority of runs, sorted."""
    if len(signal) < 2:
        return []

    all_runs = []
    rng = np.random.default_rng(0)
    for i in range(max(1, runs)):
        jittered = signal if i == 0 else signal + rng.normal(0, JITTER_STD, signal.shape)
        algo = rpt.Pelt(model=model, min_size=1, jump=1).fit(jittered)
        breakpoints = algo.predict(pen=penalty)
        # ruptures includes len(signal) as a trailing "breakpoint" marking
        # the end of the last segment — not a real changepoint, drop it.
        all_runs.append(set(bp for bp in breakpoints if bp < len(signal)))

    if len(all_runs) == 1:
        return sorted(all_runs[0])

    counts = {}
    for run in all_runs:
        for bp in run:
            counts[bp] = counts.get(bp, 0) + 1
    majority = max(1, len(all_runs) // 2 + 1)
    return sorted(bp for bp, count in counts.items() if count >= majority)


def main():
    payload = json.loads(sys.stdin.read())
    chunks = payload.get("chunks") or []
    lam = payload.get("lam") if payload.get("lam") is not None else DEFAULT_LAM
    runs = int(payload.get("runs") or DEFAULT_RUNS)
    model = cost_model_for(payload.get("noiseId"))

    texts = [c.get("text", "") for c in chunks]
    if not texts or all(not t.strip() for t in texts):
        print(json.dumps({"segmentationMap": []}))
        return

    vectors = tfidf_vectors(texts)

    changepoint_indices = detect_changepoints(vectors, lam, model, runs)

    # Each changepoint index i marks a boundary between chunk i-1 and chunk
    # i; the segment "end time" is that boundary chunk's own start (or the
    # previous chunk's end if this chunk has no usable start).
    segmentation_map = []
    for idx in changepoint_indices:
        if idx <= 0 or idx >= len(chunks):
            continue
        end_time = chunks[idx].get("start")
        if end_time is None:
            end_time = chunks[idx - 1].get("end")
        if end_time is not None:
            segmentation_map.append(end_time)

    # Always close the segmentation with the final chunk's own end (or start
    # if it has no end), so the last segment isn't left unbounded.
    last = chunks[-1]
    final_time = last.get("end") if last.get("end") is not None else last.get("start")
    if final_time is not None and (not segmentation_map or segmentation_map[-1] != final_time):
        segmentation_map.append(final_time)

    segmentation_map = sorted(set(segmentation_map))
    print(json.dumps({"segmentationMap": segmentation_map}))


if __name__ == "__main__":
    try:
        main()
    except Exception as err:  # noqa: BLE001 — reported to the Node caller, not re-raised
        print(json.dumps({"error": str(err)}))
        sys.exit(1)
