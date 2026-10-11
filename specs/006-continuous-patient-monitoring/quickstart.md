# Guide de validation — suivi continu 006

**Statut, 2026-10-11 : fonctionnalité 006 non implémentée.** Ce guide décrit le lancement et les résultats à vérifier **après réalisation du plan**. Il ne constitue pas un compte rendu de tests réussis.

Références : [plan Codex + Claude](../../docs/superpowers/plans/2026-10-11-continuous-patient-monitoring.md), [spécification](spec.md), [contrats API et budgets](contracts/api.md), [modèle de données et droits](data-model.md). Les contrats font autorité pour les champs, révisions, sources et limites ; ne pas substituer des réponses simulées aux endpoints attendus.

## Préparer un environnement fictif

Utiliser Node >=24, les dépendances existantes et la base SQLite locale. Conserver les anciens IDs, historiques et PDF privés ; vérifier la sauvegarde de migration avant d'utiliser une base existante. Ne pas effacer la base pour contourner un échec de migration.

Après ajout de la configuration prévue au lot A, préparer les secrets côté serveur à partir de `.env.example` : secret de session et trois identités médecins fictives distinctes, avec mots de passe robustes. Ne pas inscrire les secrets dans ce guide, Git, captures ou journaux. Créer le compte patient depuis l'inscription propriétaire ; si un ancien dossier doit être conservé, suivre le mode d'emploi livré avec `scripts/claim-demo-patient.ts`, sans inventer ses arguments. Aucun ancien rattachement médecin ne vaut consentement actif.

Préparer deux patients fictifs pour vérifier l'isolation, un médecin référent, un second médecin aux droits limités et un troisième sans accès. Prévoir un PDF textuel fictif accepté et un document scanné pour la revue manuelle. Toute donnée d'appareil provient du simulateur clairement identifié ; aucun matériel n'est requis.

Les modèles locaux prévus sont `gemma4:12b` pour les propositions et `qwen3-embedding:4b` pour la recherche. Leur usage est facultatif : les questions/faits déterministes, règles, messages fixes et recherche lexicale doivent rester utilisables lorsque le fournisseur est indisponible. La configuration accepte uniquement le fournisseur local autorisé par les contrats.

## Lancer après implémentation

Depuis la racine du dépôt, installer les dépendances si nécessaire :

```sh
npm ci
```

Lancer l'application dans un terminal :

```sh
npm run dev
```

Ouvrir `http://127.0.0.1:3001`. Dans un second terminal, **uniquement une fois le script ajouté par C2**, démarrer le worker sur la même configuration et la même base :

```sh
npm run monitoring:worker
```

Cette commande n'existe pas encore au moment de la rédaction. Le worker doit rester indépendant des pages ouvertes ; son arrêt doit rendre la fraîcheur de surveillance visible. Pour une répétition de production après compilation, utiliser `npm run start` à la place du serveur de développement, sur le même port.

## Parcours d'acceptation

Utiliser des profils de navigateur séparés pour patient, médecin et invité. Les courses avec réponse retenue exigent un contrôle explicite dans le harnais de test ; une simple capture ne les prouve pas.

| Parcours | Résultat attendu après réalisation |
| --- | --- |
| Compte, retour et ancien dossier | Le patient revient dans le même dossier. La migration conserve IDs/historique/PDF. L'autre patient et le troisième médecin n'y accèdent pas. Sans référent ayant accepté, le plan reste en attente et aucun médecin n'est annoncé comme surveillant. |
| Invitation et droits limités | Le médecin ciblé accepte sa propre invitation. Le secondaire ne reçoit que ses sections autorisées ; les valeurs, sources et règles exclues ne figurent pas dans les réponses. Le journal décrit les accès sans contenu clinique. |
| Révocation avec réponse retenue | Retenir un PDF, rapport, recherche ou poll, puis révoquer ou réduire le droit avant libération. Le serveur refuse les données tardives ; l'interface efface les sections devenues interdites et aucune ancienne réponse ne les restaure. Le patient conserve son dossier. |
| Onboarding et revue par élément | Une réponse inconnue demeure inconnue. Générer une mesure à domicile et un examen distincts ; approuver uniquement la mesure. Elle rejoint le plan, l'examen reste en attente, sans nom d'examen ni hypothèse présenté comme conseil patient. Modifier le contexte avant une décision impose une nouvelle revue. |
| Approbation unique et répétition | Approuver une fois ne crée aucun protocole. Autoriser explicitement un protocole borné ; une nouvelle mesure admissible déclenche une seule action. Doublon, fréquence, expiration, exclusion inconnue, changement de traitement ou message médical non revu bloquent la répétition. Une revue de message seule ne réautorise pas : une nouvelle révision explicite est nécessaire. |
| Couverture et épisode rouge | Tension récente + glycémie périmée, maladie hors profil ou couverture basse non configurée empêchent un vert global. Une mesure rassurante, une lecture, une action déclarée ou un accusé ne clôturent pas un rouge ; seule une résolution médicale explicite le fait. Le message rouge fixe fonctionne sans modèle. |
| Intervention réelle | Envoyer un message médecin et le recevoir dans le compte patient. Distinguer transmission, lecture, déclaration d'action et résolution. Une demande d'appel reste une demande ; ne pas afficher appel connecté ou intervention accomplie. |
| Recherche sourcée et absence de preuve | Retrouver un extrait autorisé avec sa source ; exclure les autres patients et documents hors droits avant classement. Une question sans preuve l'indique. Une référence générale ne devient ni fait patient ni consigne autorisée. Indisponibilité du modèle affiche le mode de repli. |
| Simulateur | Recevoir deux fois le même événement donne une mesure, toujours marquée simulée. L'heure de mesure détermine la fraîcheur, même après arrivée tardive. Unité invalide, appareil non associé ou droit révoqué sont refusés ; le pouls reste non évalué. |
| Consultation externe | L'aperçu du lien ne révèle rien et ne l'active pas. Deux activations concurrentes donnent une seule session ; celle-ci lit plusieurs éléments sélectionnés et le PDF autorisé. Un élément exclu demeure inaccessible. L'ajout puis la correction créent des notes distinctes à auteur déclaré non vérifié. Révocation pendant lecture/ajout empêche nouvelle libération ou écriture ; les notes déjà enregistrées restent chez le patient. Vérifier expiration, inactivité et fin explicite de session. |
| Worker, reprise et doublons | Fermer les pages et constater une tâche due depuis le worker. Interrompre/reprendre le processus ; une tâche réclamée récupérable ne produit pas de deuxième action. Deux workers ne contournent pas la déduplication. Une revue en retard ne devient jamais approuvée par silence. |
| Français, arabe, mobile et hors connexion | Répéter les parcours importants en français puis arabe RTL à 390 px réels, avec clavier et focus d'erreur. Conserver la capture hors connexion existante ; aucun nouveau chat, accord ou message n'est annoncé reçu sans réponse serveur. Médecin/invité et secrets ne sont pas stockés hors connexion ; sortie/changement de compte purge les vues privées. |

## Vérifications et preuves à enregistrer

Après intégration, exécuter séparément les commandes existantes :

```sh
npm test
npm run typecheck
npm run build
```

Les sous-plans précisent les tests ciblés et leurs fichiers à créer. Consigner commande, date, résultat et artefact pour chaque parcours ; séparer réussite automatique, observation navigateur et limite restante. Le script actuel `demo:rehearse` ne prouve pas les nouvelles fonctions 006 tant qu'il n'est pas adapté. Une démonstration locale ne démontre ni validation clinique, ni connexion matérielle, ni disponibilité permanente d'un médecin.
