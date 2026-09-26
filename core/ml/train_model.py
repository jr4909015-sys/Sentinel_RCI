"""
Train the Sentinel incident classifier.

Model:
    TF-IDF (word + bigram features) + Logistic Regression.

Run from the Django project root:
    python core\\ml\\train_model.py
"""
from pathlib import Path
import json
import pandas as pd
import joblib

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

BASE_DIR = Path(__file__).resolve().parent
DATASET_PATH = BASE_DIR / "incident_dataset.csv"
MODEL_PATH = BASE_DIR / "incident_classifier.joblib"
METRICS_PATH = BASE_DIR / "training_metrics.json"

LABELS = ["fire", "med", "sec", "accident"]

def main():
    if not DATASET_PATH.exists():
        raise FileNotFoundError(f"Dataset not found: {DATASET_PATH}")

    df = pd.read_csv(DATASET_PATH).dropna()
    df["description"] = df["description"].astype(str).str.strip()
    df["category"] = df["category"].astype(str).str.strip().str.lower()
    df = df[df["category"].isin(LABELS)]

    if df["category"].nunique() < 4:
        raise ValueError("The dataset must contain all four categories: fire, med, sec, accident.")

    X_train, X_test, y_train, y_test = train_test_split(
        df["description"],
        df["category"],
        test_size=0.20,
        random_state=42,
        stratify=df["category"],
    )

    model = Pipeline([
        ("tfidf", TfidfVectorizer(
            lowercase=True,
            strip_accents="unicode",
            ngram_range=(1, 2),
            sublinear_tf=True,
            min_df=1,
        )),
        ("classifier", LogisticRegression(
            max_iter=2000,
            class_weight="balanced",
            random_state=42,
        )),
    ])

    model.fit(X_train, y_train)

    predictions = model.predict(X_test)
    accuracy = accuracy_score(y_test, predictions)
    report = classification_report(
        y_test, predictions, labels=LABELS, output_dict=True, zero_division=0
    )

    joblib.dump(model, MODEL_PATH)

    metrics = {
        "model": "TF-IDF + Logistic Regression",
        "dataset_rows": int(len(df)),
        "training_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "accuracy": round(float(accuracy), 4),
        "classification_report": report,
        "labels": LABELS,
    }
    METRICS_PATH.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    print(f"Model saved: {MODEL_PATH}")
    print(f"Accuracy on held-out test set: {accuracy:.2%}")
    print(f"Metrics saved: {METRICS_PATH}")

if __name__ == "__main__":
    main()
