# Acme architecture notes

The Data Platform project migrates ingestion from the legacy ETL to Airflow.
The ingestion service depends on Vault (Platform team) for credentials.
Warehouse loads depend on the ingestion service. The identity model for the
new ingestion path still needs Security sign-off.
