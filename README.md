# Santetrace

Prototype HackCure de suivi des patients entre deux consultations : dossier partagé, mesures à domicile, documents médicaux sourcés, suivi continu et supervision par le médecin. L’interface web propose des espaces patient, médecin et consultation externe, en français et en arabe.

Projet présenté par l’équipe **Khaliha 3la Claude**.

## Fonctionnement

- Le patient renseigne ses déclarations, ses mesures et ses documents, puis contrôle les accès au dossier.
- Le médecin consulte la file de patients, les preuves et les alertes ; il revoit les propositions avant de les approuver.
- Le suivi applique des règles déterministes et des protocoles approuvés. L’estimation IA, lorsqu’elle existe, reste distincte de la couleur d’urgence.
- Les PDF sont conservés hors des fichiers publics. Le texte disponible produit des candidats qui nécessitent une vérification d’identité, de valeur, d’unité et de date.
- Les messages sont enregistrés par HTTP. Le serveur WebSocket notifie les vues autorisées, avec repli sur interrogation périodique.
- L’assistant patient répond dans le périmètre du dossier et du plan approuvé ; il peut transmettre une question au médecin.

Le stockage actif est **SQLite**, via `node:sqlite`, avec transactions et audit. La dépendance Supabase est historique et n’est pas nécessaire pour exécuter ce parcours.

## Démarrer localement

Prérequis : **Node.js 24 ou ultérieur** et npm. Le verrou de dépendances fixe notamment Next.js 16.4.0, React 19.3.0 et TypeScript 5.9.3.

```sh
npm ci
cp .env.example .env.local
openssl rand -hex 32
```

Dans `.env.local`, renseigner `SESSION_SECRET` avec la valeur générée et `DEMO_CLINICIAN_PASSWORD` avec un mot de passe privé d’au moins 12 caractères. Les valeurs vides sont des emplacements à compléter. Sans mot de passe configuré, le compte médecin est désactivé.

```sh
npm run dev:live
```

Ouvrir [http://127.0.0.1:3001](http://127.0.0.1:3001). Dans un second terminal, lancer le suivi avec le **même fichier SQLite** :

```sh
npm run monitoring:worker
```

Ces commandes chargent `.env.local`. `APP_ORIGIN` doit correspondre exactement à l’origine du navigateur, sans chemin. Les chemins locaux par défaut sont `.data/care.sqlite` et `.data/care-documents` ; ces fichiers privés sont créés localement et exclus du dépôt.

Pour un build de production local :

```sh
npm run build
npm run start:live
```

Les commandes `npm run dev` et `npm start` restent disponibles pour HTTP seul. Si un environnement de compilation isolé utilise un lien symbolique vers `node_modules` extérieur au projet, utiliser `npm run build -- --webpack`.

## Parcours de démonstration

1. Créer un compte patient fictif, compléter les déclarations et consentir au traitement de démonstration.
2. Se connecter comme médecin avec `medecin.ref` et le mot de passe configuré ; établir et accepter l’accès au dossier depuis les deux espaces.
3. Saisir une mesure datée avec son unité, puis consulter la mesure, sa provenance et l’évaluation dans les deux vues.
4. Ajouter le PDF **synthétique** [Fatma HbA1c](demos/fatma-hba1c.pdf) au dossier fictif correspondant. Revoir les candidats avant confirmation et ouvrir la source protégée.
5. Revoir un plan ou un protocole, échanger un message et tester le partage externe limité.
6. Sur la page des appareils, utiliser le simulateur explicitement identifié ; la répétition d’un événement ne doit créer qu’une seule mesure.

La connexion rapide de démonstration est désactivée par défaut. Son activation ne crée aucun compte : elle exige les comptes fictifs spécifiques déjà présents et un dossier entièrement fictif. Un clone neuf utilise le parcours de création de compte.

## IA facultative

Le parcours fonctionne avec les modèles désactivés et signale les replis déterministes. L’assistant patient est borné et déterministe ; les modèles servent aux brouillons et estimations destinés au médecin.

Pour la génération NVIDIA, configurer côté serveur `HACKCURE_AI_PROVIDER=nvidia`, `NVIDIA_API_KEY` et `HACKCURE_NVIDIA_MODEL=nvidia/nemotron-3-super-120b-a12b`. La recherche reste lexicale dans ce mode.

Pour ajouter le spécialiste local expérimental MedGemma, installer séparément le modèle dans Ollama puis configurer `HACKCURE_MEDICAL_SPECIALIST_ENABLED=true`, `HACKCURE_MEDICAL_SPECIALIST_MODEL=hf.co/unsloth/medgemma-1.5-4b-it-GGUF:Q4_K_M` et `HACKCURE_OLLAMA_BASE_URL=http://127.0.0.1:11434`. Le spécialiste sélectionne au plus trois preuves, sans questions ni propositions ; le serveur valide les sources, les droits et la version du dossier. Les budgets sont de huit secondes pour le spécialiste et trente secondes au total.

La génération locale seule utilise `HACKCURE_AI_PROVIDER=ollama` et `HACKCURE_LOCAL_AI_ENABLED=true`, avec les modèles installés correspondant à `HACKCURE_GENERATION_MODEL` et `HACKCURE_EMBEDDING_MODEL`. Les poids ne sont pas fournis et nécessitent les conditions d’utilisation de leurs éditeurs. Les clés restent privées et ne doivent jamais porter le préfixe `NEXT_PUBLIC_`.

## IoT et vérification

La [passerelle ESP32](firmware/contour-gateway/README.md) implémente le Bluetooth Glucose Service, une file LittleFS persistante, l’envoi HTTPS et un acquittement vérifié. Le [guide de provisionnement](docs/iot-contour-gateway.md) contient les versions et contraintes. La compilation ESP32 et les tests hôte ont été documentés ; **le glucomètre, son profil BLE et la chaîne radio sur matériel réel restent non vérifiés**.

```sh
npm run typecheck
npm test
node --import tsx scripts/rehearse-device-ingress.ts
```

La répétition IoT utilise une base en mémoire et des octets synthétiques. Elle ne contacte aucun appareil ni service réseau. Les [revues de code et de sécurité](docs/submission-evidence.md) indiquent leur périmètre, leurs preuves et leurs limites ; leurs compteurs correspondent aux vérifications datées décrites.

## Documentation et périmètre

- [Fiche technique en français](docs/santetrace-fiche-technique.md), également disponible en [PDF](docs/santetrace-fiche-technique.pdf) et [DOCX](docs/santetrace-fiche-technique.docx).
- [Dossier de conception du suivi continu](specs/006-continuous-patient-monitoring/spec.md) et [contrat API de conception](specs/006-continuous-patient-monitoring/contracts/api.md). Ces documents datés conservent des étapes préalables à l’implémentation ; suivre les commandes du présent README pour exécuter la version soumise.
- [Politique des références du prototype](research/monitoring-prototype-policy.md), identifiée par empreinte dans le manifeste de recherche.

Ce prototype utilise des données fictives et des seuils de démonstration. Il n’a pas de validation clinique, ne fournit pas de diagnostic ni de changement autonome de traitement, et ne garantit pas une réponse médicale. L’OCR général, la visioconférence et le diagnostic d’imagerie ne sont pas des fonctionnalités livrées. Il s’agit d’une application web/PWA, sans binaire natif iOS ou Android.

Le dépôt conserve les licences des composants PDF.js et de leurs ressources. Aucune licence globale du code du projet n’a été déclarée dans cette soumission ; les dépendances, modèles et poids conservent leurs licences et conditions propres.
