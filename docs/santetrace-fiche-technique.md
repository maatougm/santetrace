# Santetrace fiche technique

Synthèse technique de la soumission HackCure du 11 octobre 2026.

Santetrace est un prototype web de suivi patient entre deux consultations. Le patient centralise ses déclarations, mesures et documents et contrôle les accès. Le médecin dispose d’un dossier sourcé, d’une file de patients, d’alertes et de propositions à revoir. La validation porte sur le logiciel et des données fictives ; la validation clinique et l’intégration d’un glucomètre réel restent à réaliser.

## Architecture et stockage

React 19, Next.js 16 et TypeScript composent l’interface responsive en français et en arabe. Les API HTTP appellent les services métier sous Node.js 24. Le stockage actif est SQLite via node:sqlite, avec transactions, historique, audit et déduplication des actions. Les PDF privés sont conservés séparément et accessibles par des routes autorisées. Supabase reste une dépendance historique ; il ne pilote pas ces parcours.

Les notifications WebSocket du serveur Node personnalisé actualisent les écrans après enregistrement. Elles transportent des indications génériques ; les données sont relues avec une requête autorisée. Un repli par interrogation périodique est prévu. La PWA utilise un service worker et une file IndexedDB limitée pour certaines actions hors connexion ; elle n’est pas un binaire natif iOS ou Android.

## Parcours et supervision

Le patient crée son compte fictif, complète le dossier, saisit des mesures avec date et unité, importe un document et choisit les accès. Le médecin consulte les preuves et les tendances, revoit un plan ou un protocole et échange des messages. Le partage externe utilise un lien à usage unique, une session distincte et une sélection limitée de données ; un médecin invité peut ajouter une note dont la provenance est conservée.

La couleur d’urgence provient de règles déterministes. Les protocoles gardent leurs conditions d’application et leur approbation. Les propositions d’IA restent des brouillons. Un résultat extrait d’un PDF nécessite une confirmation d’identité, de valeur, d’unité et de date avant de devenir une observation confirmée ; les corrections conservent leur raison et leur historique.

## IA facultative et bornée

Le parcours fonctionne sans modèle. L’assistant patient fournit des réponses déterministes dans le périmètre du dossier et du plan approuvé, puis peut transmettre une question au médecin. Il ne constitue pas un chatbot médical libre.

La génération facultative peut utiliser Ollama localement ou Nemotron via NVIDIA. Le pipeline expérimental MedGemma 1.5 4B en Q4_K_M puis Nemotron 3 Super 120B sélectionne des preuves admises et produit une sortie structurée. Le spécialiste est limité à trois preuves, sans question ni proposition. Son budget est de huit secondes à l’intérieur d’un budget total de trente secondes.

Le serveur contrôle le schéma, les sources, les bornes, les droits courants et la version du dossier après les appels asynchrones. Un résultat indisponible ou invalide produit un repli signalé. L’indice de cas de 0 à 100 est une estimation expérimentale distincte de l’urgence et n’autorise aucun changement de traitement. Les clés API restent côté serveur ; les poids des modèles ne sont pas inclus.

## Passerelle IoT

La chaîne prévue est glucomètre BLE, passerelle ESP32, HTTPS, API d’ingestion puis dossier et suivi. La passerelle logicielle utilise Arduino ESP32, NimBLE, ArduinoJson, LittleFS et PlatformIO. Elle décode le Bluetooth Glucose Service, conserve l’heure d’origine et l’unité, puis enregistre chaque événement dans une file durable.

Un jeton est affiché une seule fois lors de la liaison appareil patient ; le serveur conserve son empreinte. La passerelle vérifie le certificat TLS et le reçu métier avant d’avancer son acquittement. Un identifiant stable déduplique les reprises ; les erreurs et saturations placent les événements en quarantaine sans suppression silencieuse. Le simulateur de l’interface reste explicitement identifié.

La compilation ESP32 et les tests hôte sont documentés dans le dépôt. Aucun ESP32 ni glucomètre physique n’a été fourni : profil du Contour Next One, association BLE, transmission radio et récupération sur matériel réel ne sont pas vérifiés. La protection physique de la mémoire du prototype doit également être validée avant un usage réel.

## Sécurité et preuves

Les contrôles serveur portent sur les sessions, le consentement, les périmètres de lecture, la révocation, l’origine des requêtes, les versions du dossier et les reprises idempotentes. Les propositions et résultats dérivés sont liés au contexte autorisé ; une révocation empêche leur restitution tardive. Les secrets sont absents des fichiers publics et des notifications.

La réalisation utilise Spec Kit, Codex et Claude Code. Les vérifications documentées comprennent les suites TypeScript et tsx, les revues indépendantes de code et de sécurité, les essais navigateur et la compilation firmware. Les revues précisent le périmètre et les empreintes approuvés ; elles ne constituent pas une certification médicale ou de conformité.

Les limites sont un serveur de démonstration unique, des données fictives, l’absence de validation clinique et de matériel IoT réel. L’OCR général, la visioconférence et le diagnostic d’IRM ou de scanner ne sont pas livrés. Les licences des dépendances et modèles demeurent applicables ; aucune licence globale du code du projet n’est déclarée dans cette soumission.
