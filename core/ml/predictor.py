"""
Reusable ML prediction service for Sentinel.

The trained model is loaded once per Django process and then reused.
"""
from pathlib import Path
from functools import lru_cache
import joblib

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "incident_classifier.joblib"

LABEL_NAMES = {
    "fire": "Fire",
    "med": "Medical",
    "sec": "Security",
    "accident": "Accident",
}

@lru_cache(maxsize=1)
def _load_model():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"ML model not found at {MODEL_PATH}. "
            "Run: python core\\ml\\train_model.py"
        )
    return joblib.load(MODEL_PATH)

def classify_incident(description: str) -> dict:
    text = (description or "").strip()
    if not text:
        raise ValueError("Incident description is required for ML classification.")

    model = _load_model()
    probabilities = model.predict_proba([text])[0]
    classes = list(model.classes_)
    best_index = int(probabilities.argmax())
    category = str(classes[best_index])
    confidence = float(probabilities[best_index])

    ranked = sorted(
        [
            {
                "category": label,
                "label": LABEL_NAMES.get(label, label.title()),
                "confidence": round(float(prob), 4),
            }
            for label, prob in zip(classes, probabilities)
        ],
        key=lambda item: item["confidence"],
        reverse=True,
    )

    return {
        "category": category,
        "label": LABEL_NAMES.get(category, category.title()),
        "confidence": round(confidence, 4),
        "confidence_percent": round(confidence * 100, 2),
        "alternatives": ranked[:4],
    }

def clear_model_cache():
    """Call this after retraining while a Django process is still running."""
    _load_model.cache_clear()
