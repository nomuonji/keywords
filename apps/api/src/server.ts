import app from './app';

const port = process.env.PORT ?? 3001;

console.log('GCP_PROJECT_ID at app.listen:', process.env.GCP_PROJECT_ID);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});
