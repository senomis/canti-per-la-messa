// Dati del progetto Supabase: Project Settings → API (o "API Keys").
// Usa la chiave pubblica ("anon" / "publishable"), MAI la "service_role"/"secret".
// Se lasci vuoti i due valori, l'app parte in MODALITÀ DEMO con dati di esempio in memoria.
export const SUPABASE_URL = 'https://kwbaggxavtxesccxhfil.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_RF_lTjQqBNbbGL15dXJLqw_rYn83oRo';

// Dimensione massima di un singolo PDF (deve essere <= al limite impostato sul bucket).
export const MAX_FILE_MB = 20;

// Tipologie dei canti. L'"id" viene salvato nel database: non cambiarlo dopo aver
// caricato i canti. L'etichetta invece si può modificare liberamente.
export const TAGS = [
  { id: 'ingresso', label: 'Ingresso' },
  { id: 'vangelo', label: 'Al Vangelo' },
  { id: 'offertorio', label: 'Offertorio' },
  { id: 'comunione', label: 'Comunione' },
  { id: 'conclusione', label: 'Conclusione' },
  { id: 'spirito_santo', label: 'Spirito Santo' },
  { id: 'natalizio', label: 'Natalizio' },
  { id: 'pasquale', label: 'Pasquale' },
  { id: 'quaresimale', label: 'Quaresimale' },
  { id: 'avvento', label: 'Avvento' },
  { id: 'mariano', label: 'Mariano' },
  { id: 'missionario', label: 'Missionario' },
  { id: 'altro', label: 'Altro' },
];
