# Sentinel IR System — ML Incident Classification

This project now includes a working machine-learning incident classifier integrated with the existing Django incident-reporting flow.

## ML model

- TF-IDF text vectorization (unigrams + bigrams)
- Logistic Regression classifier
- Four existing incident categories:
  - `fire`
  - `med`
  - `sec`
  - `accident`

The reporter's selected incident type is **not silently overwritten**. The ML model classifies the description as decision support, and the prediction + confidence are saved in `Incident.operator_notes` and returned by the reporting API.

## 1. Open the correct project folder

PowerShell:

```powershell
cd "C:\Users\Windows User\Downloads\Sentinel_IRSYS (1)\Sentinel_IRSYS"
```

Check:

```powershell
dir manage.py
```

You should see `manage.py`.

## 2. Install the ML packages

Use the same Python environment that runs your Django project:

```powershell
python -m pip install -r requirements.txt
```

If you are using a virtual environment, activate it first.

## 3. Train/retrain the model

From the folder containing `manage.py`:

```powershell
python core\ml\train_model.py
```

This creates:

```text
core/ml/incident_classifier.joblib
core/ml/training_metrics.json
```

The supplied dataset contains 120 labeled examples (30 per category). The included training run uses an 80/20 stratified hold-out test split. Its measured accuracy was 83.33% on that small demonstration test set. This is not a claim of production accuracy; replace/expand the dataset with real, reviewed school incident reports for research evaluation.

## 4. Check Django

```powershell
python manage.py check
```

Then:

```powershell
python manage.py runserver
```

Open:

```text
http://127.0.0.1:8000/
```

## 5. How ML is used when reporting

When a reporter submits an incident:

```text
Description
   ↓
TF-IDF
   ↓
Logistic Regression
   ↓
Predicted category + confidence
   ↓
Incident is saved
   ↓
ML result is stored in operator notes
   ↓
API returns ML result
```

Example stored notes:

```text
Severity: high
ML Classification: Medical (med)
ML Confidence: 91.20%
Reporter Selected Type: med
```

The success screen also shows:

```text
ML: Medical — Confidence 91.20%
```

## 6. Test the classifier without submitting an incident

The project has this endpoint:

```text
POST /api/classify-incident/
```

It accepts JSON:

```json
{
  "description": "A student fainted and is unconscious."
}
```

It returns the predicted category, label, confidence, and ranked alternatives.

## 7. Retraining with your own data

Edit:

```text
core/ml/incident_dataset.csv
```

Keep these columns:

```csv
description,category
```

Allowed category values:

```text
fire
med
sec
accident
```

Then retrain:

```powershell
python core\ml\train_model.py
```

Restart Django after retraining.

## Important

The ML model is a decision-support classifier. It should not replace human emergency judgment. The existing reporter-selected category remains the stored incident category so the current system behavior and database remain compatible.
