import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { trainingsRouter } from './routes/trainings.js';
import { adminRouter } from './routes/admin.js';
import { bootstrapAdmin } from './bootstrapAdmin.js';
import './db.js';

bootstrapAdmin();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/trainings', trainingsRouter);
app.use('/api/admin', adminRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Interner Serverfehler.' });
});

app.listen(PORT, () => {
  console.log(`Fortbildungen-Swipe API läuft auf Port ${PORT}`);
});
