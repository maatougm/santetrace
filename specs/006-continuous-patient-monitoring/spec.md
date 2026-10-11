# Feature Specification: Suivi continu du patient avec supervision médicale

**Feature Branch**: `codex/hackcure`

**Created**: 2026-10-11

**Status**: Périmètre approuvé le 2026-10-11 (« Oui, prépare le plan Codex + Claude »). Plan détaillé prêt à relire ; aucun code de cette refonte n'est encore implémenté.

**Input**: Correction directe de l'utilisateur : plateforme de suivi de l'état du patient à partir d'un dossier centralisé, onboarding IA, mesures et examens proposés, classement vert/orange/rouge, conseils supervisés puis réutilisables, recherche sémantique, intervention du médecin, appareils connectés et partage ponctuel avec un médecin externe. Confirmation : mesures à domicile ET examens proposés au médecin ; aucun appareil disponible pour la démonstration. Cette direction remplace la limitation au diabète de la fonctionnalité 005.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Posséder un dossier exploitable (Priority: P1)

Le patient possède son compte et son dossier. Il dépose ses traitements, résultats et comptes rendus, puis répond à des questions adaptées aux informations présentes ou manquantes. Il choisit les médecins qui pourront accéder à son dossier.

**Why this priority**: Un suivi longitudinal exige une identité stable, un historique et des droits explicites.

**Independent Test**: Un patient fictif revient dans son compte, retrouve ses documents et réponses, et donne puis retire l'accès à un médecin sans perdre son dossier.

**Acceptance Scenarios**:

1. **Given** un nouveau patient, **When** il crée son compte et revient, **Then** il retrouve le même dossier ; un autre patient ne peut pas le consulter.
2. **Given** un document importé, **When** l'IA propose des faits extraits, **Then** la source, la date et le statut de vérification sont visibles ; une proposition ne devient pas automatiquement un résultat médical confirmé.
3. **Given** un partage autorisé, **When** le patient le révoque, **Then** le prochain accès du médecin est refusé, le contenu déjà affiché est effacé de l'interface et le patient conserve son propre accès.
4. **Given** un patient sans médecin référent ayant accepté l'accès, **When** il termine l'onboarding, **Then** son dossier reste utilisable et le plan est « en attente de médecin » ; aucune surveillance humaine, approbation ou transmission à un médecin n'est supposée.

### User Story 2 — Obtenir un plan de suivi supervisé (Priority: P1)

Après l'onboarding, l'IA prépare des propositions séparées : informations à compléter, mesures à domicile et examens à envisager. Le médecin référent peut modifier, approuver ou rejeter chaque proposition. Le patient voit ce qui est proposé, validé, en attente ou terminé.

**Why this priority**: Les données recueillies doivent conduire à une prochaine étape compréhensible et attribuée.

**Independent Test**: Avec un dossier fictif préexistant, le médecin approuve une mesure à domicile et laisse un examen en attente ; seul l'élément approuvé devient une action du plan patient.

**Acceptance Scenarios**:

1. **Given** des réponses et documents incomplets, **When** l'onboarding continue, **Then** il demande les éléments manquants pertinents, permet « je ne sais pas » et ne transforme pas cette réponse en absence de maladie ou de symptôme.
2. **Given** deux propositions, **When** le médecin en approuve une, **Then** l'autre reste en attente ; l'approbation identifie la version, les éléments examinés et le médecin.
3. **Given** une proposition fondée sur un ancien état, **When** un nouveau traitement ou symptôme est ajouté avant approbation, **Then** elle est signalée comme à réexaminer, sans validation silencieuse du nouvel état.

### User Story 3 — Suivre l'évolution et prioriser les patients (Priority: P1)

Le patient saisit des mesures et informations de suivi. La plateforme réévalue les données nouvelles et les échéances du plan. Le médecin voit ses patients par priorité avec l'évolution, les raisons et les preuves du classement.

**Why this priority**: La valeur principale est de rendre visible ce qui change entre deux consultations et de guider la revue humaine.

**Independent Test**: Un jeu de patients fictifs produit des priorités expliquées, un cas avec données manquantes et un épisode rouge qui reste ouvert après une mesure rassurante.

**Acceptance Scenarios**:

1. **Given** des données récentes suffisantes pour un profil de suivi, **When** elles sont évaluées, **Then** une priorité vert/orange/rouge précise son périmètre, ses sources et la version des règles.
2. **Given** une tension récente et une glycémie périmée, **When** la vue générale est calculée, **Then** la tension ne masque pas le manque de suivi glycémique ; un vert global rassurant est impossible.
3. **Given** un épisode rouge non résolu, **When** une mesure verte arrive, **Then** l'épisode reste visible jusqu'à une résolution explicite et motivée du médecin.
4. **Given** une maladie sans profil de suivi disponible, **When** elle est enregistrée, **Then** le dossier la conserve et affiche la couverture inconnue ; aucune classification clinique universelle n'est inventée.

### User Story 4 — Être accompagné et réutiliser une consigne approuvée (Priority: P1)

Le chatbot recueille les difficultés, explique les informations du dossier et présente les consignes approuvées. Une première proposition orange est soumise au médecin. Celui-ci peut autoriser explicitement sa réutilisation sous conditions précises pour ce patient.

**Why this priority**: L'accompagnement devient utile quand il suit une décision médicale et son résultat dans le temps.

**Independent Test**: Montrer une première approbation, une répétition éligible, puis une situation ressemblante avec un changement de traitement qui bloque la réutilisation.

**Acceptance Scenarios**:

1. **Given** une première consigne orange, **When** le médecin l'approuve une fois, **Then** cela ne crée pas implicitement une autorisation permanente.
2. **Given** un protocole réutilisable explicitement approuvé, **When** un événement satisfait toutes ses conditions actuelles, **Then** la consigne autorisée est appliquée une fois et conserve les raisons de son éligibilité.
3. **Given** une situation sémantiquement similaire mais des données manquantes, un nouveau symptôme, un protocole expiré ou un changement de traitement, **When** elle est examinée, **Then** la réutilisation est bloquée et une nouvelle revue est demandée.
4. **Given** un médecin qui ne répond pas, **When** le délai de revue est dépassé, **Then** l'attente reste visible ; le silence ne vaut pas approbation.

### User Story 5 — Permettre une intervention traçable (Priority: P1)

Le médecin ouvre un rapport IA sourcé, vérifie les changements et informations manquantes, puis répond au patient. Les hypothèses éventuelles restent des pistes à examiner dans l'espace médecin. Le patient voit le message, la prochaine action et son échéance.

**Why this priority**: Une alerte doit déboucher sur une prise en charge observable, sans confondre réception et résolution.

**Independent Test**: Un médecin répond depuis la file priorisée ; le patient lit le message, signale l'action effectuée et le médecin clôture séparément l'épisode.

**Acceptance Scenarios**:

1. **Given** un rapport IA, **When** le médecin consulte une affirmation, **Then** il retrouve ses sources et peut distinguer fait confirmé, déclaration patient, hypothèse et information manquante.
2. **Given** un épisode rouge, **When** il est détecté, **Then** un message fixe adapté au scénario apparaît sans attendre le modèle ; l'état d'envoi et la réponse du médecin restent distincts.
3. **Given** une demande d'appel, **When** elle est envoyée, **Then** elle n'est pas présentée comme un appel établi ou une intervention accomplie.
4. **Given** un conseil ou un rappel, **When** le patient le lit, **Then** cela ne signifie ni action effectuée ni résolution de l'alerte.

### User Story 6 — Chercher dans le dossier et les références (Priority: P2)

Le médecin cherche par sens dans les données qu'il a le droit de consulter et dans une bibliothèque de références identifiées. Les résultats servent la revue et conservent leurs sources.

**Why this priority**: Retrouver rapidement une information peut améliorer l'utilité du rapport, après la boucle de suivi essentielle.

**Independent Test**: Une question retrouve un extrait de document autorisé ; une question sans réponse produit une absence de preuve explicite.

**Acceptance Scenarios**:

1. **Given** des documents autorisés et exclus, **When** une recherche est lancée, **Then** seuls les éléments autorisés apparaissent, y compris dans les résumés et sources.
2. **Given** une référence générale, **When** elle est retrouvée, **Then** elle n'est pas assimilée à une consigne approuvée pour ce patient.

### User Story 7 — Recevoir une mesure d'un connecteur (Priority: P2)

La plateforme accepte des mesures provenant d'appareils via des connecteurs. En démonstration, un simulateur identifié produit glycémie, tension et pouls avec provenance et dates.

**Why this priority**: Tester l'intégration sans prétendre disposer d'un appareil réel.

**Independent Test**: Une mesure simulée rejoint le bon dossier une seule fois ; une mesure ancienne ne devient pas récente à son arrivée.

**Acceptance Scenarios**:

1. **Given** une mesure simulée, **When** elle est reçue deux fois, **Then** un seul événement apparaît, portant la mention « simulé », son unité et l'heure de mesure.
2. **Given** un appareil non associé ou une unité invalide, **When** une mesure arrive, **Then** elle n'est pas affectée arbitrairement à un patient ni évaluée comme valide.
3. **Given** un pouls sans profil de règles applicable, **When** il arrive, **Then** sa valeur est visible avec une couverture non évaluée, sans priorité inventée.

### User Story 8 — Consulter un médecin externe (Priority: P2)

Le patient choisit des éléments de son dossier et crée un lien utilisable une fois. Le destinataire, sans compte de l'application, ouvre une courte session pour consulter cette sélection et ajouter une note. L'historique reste intact.

**Why this priority**: Le patient peut réutiliser son dossier lors d'une consultation hors de la plateforme.

**Independent Test**: Le destinataire ouvre plusieurs éléments et un document dans la même session, ajoute une note, puis perd l'accès après révocation ; le patient conserve la note.

**Acceptance Scenarios**:

1. **Given** un lien prêt à partager, **When** un aperçu automatique l'ouvre, **Then** aucun dossier n'est révélé et le lien reste utilisable.
2. **Given** un lien à usage unique, **When** deux destinataires tentent son activation, **Then** un seul obtient une session ; celle-ci permet les consultations successives des éléments choisis.
3. **Given** une session externe, **When** le destinataire ajoute une note, **Then** elle conserve son auteur déclaré et son statut non vérifié, sans écraser un résultat ou approuver un protocole.
4. **Given** une révocation pendant une lecture ou un enregistrement, **When** l'opération reprend, **Then** elle ne libère pas de nouvelles données et n'enregistre pas de nouvelle note sans droits actuels.

### Edge Cases

- Résultat extrait non confirmé, unité incomparable, mauvaise date, doublon, document contradictoire ou information explicitement inconnue.
- Plusieurs maladies avec couvertures différentes ; données partielles ; mesure tardive ; symptôme ou traitement ajouté pendant une proposition IA.
- Modèle indisponible, réponse invalide ou texte importé contenant des instructions : la saisie, la file médecin et les messages fixes restent disponibles.
- Médecin absent, revue en retard, patient hors connexion : les états en attente, envoyé, lu, pris en compte et résolu ne sont jamais confondus.
- Révocation pendant recherche, génération du rapport, lecture d'une source, soumission de note ou répétition d'une action.
- Lien externe transféré : sa possession n'établit ni identité ni qualité de médecin ; les limites de cette attribution sont visibles.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Continuer l'application existante et préserver dossiers, documents, historique et mécanismes de protection des comptes. Le diabète est un exemple de suivi, pas une restriction du dossier.
- **FR-002**: Permettre un compte patient durable et des accès médecins choisis, limités, révocables et journalisés. Les autorisations portent aussi sur rapports, recherches, fichiers et opérations différées.
- **FR-003**: Centraliser mesures, symptômes déclarés, traitements déclarés, résultats, documents, propositions, décisions et notes avec date, provenance et niveau de vérification.
- **FR-004**: Adapter l'onboarding aux réponses et données disponibles ; autoriser les réponses inconnues et corrections, sans inventer une réponse ou un fait clinique.
- **FR-005**: Produire des propositions distinctes de mesures à domicile et d'examens médicaux/laboratoires ; leur justification cite les informations utilisées et manquantes. Le médecin peut les éditer, approuver ou rejeter séparément. Avant validation, le patient voit l'état de revue et les informations à compléter ; le nom d'un nouvel examen et les hypothèses ne sont pas présentés comme des recommandations patient.
- **FR-006**: Afficher un plan versionné comportant actions autorisées, échéances, auteur de validation et progression. Une nouvelle ordonnance ou un examen non approuvé ne devient pas une instruction patient.
- **FR-007**: Réévaluer à chaque donnée acceptée et aux échéances de suivi ; afficher l'heure d'évaluation et la fraîcheur des informations. Toute périodicité dépend du plan actif et reste observable.
- **FR-008**: Utiliser des profils de suivi versionnés par condition et contexte pour le classement. La couleur et son explication proviennent de règles inspectables ; l'IA structure et explique les données, sans déterminer librement la priorité.
- **FR-009**: Rendre visible la couverture complète, manquante, périmée, contradictoire, en attente de vérification ou non disponible. Un vert global exige une couverture actuelle suffisante de tous les suivis activés et aucun épisode supérieur non résolu ; une condition enregistrée hors couverture empêche ce vert global. Une carte particulière peut être verte tout en indiquant clairement son seul périmètre évalué.
- **FR-010**: Conserver la priorité d'un épisode rouge non résolu ; aucune moyenne entre maladies ni mesure verte isolée ne le masque. La clôture demande une décision médicale explicite.
- **FR-011**: Afficher des encouragements limités au périmètre effectivement évalué. Le chatbot peut recueillir des informations, expliquer le dossier et présenter les consignes validées ; une nouvelle action médicale devient une proposition à revoir.
- **FR-012**: Séparer l'approbation unique d'une proposition et l'autorisation explicite d'un protocole réutilisable. Chaque protocole précise patient, version, actions exactes, conditions requises, exclusions, fraîcheur, durée, fréquence maximale et critères d'arrêt.
- **FR-013**: Autoriser une répétition uniquement si toutes les conditions actuelles sont satisfaites. La similarité sémantique retrouve un candidat mais n'autorise pas son application. Un changement pertinent, une donnée inconnue, une révocation ou une expiration bloque la répétition.
- **FR-014**: Préserver l'identité du validateur, la version de proposition, les preuves examinées et les raisons de chaque application. Une répétition réseau ne crée pas une deuxième consigne, note ou demande d'examen.
- **FR-015**: Présenter aux médecins une file priorisée et un rapport distinguant faits confirmés, déclarations, changements, contradictions, éléments manquants et hypothèses à examiner. Les hypothèses ne sont ni diagnostics établis ni conclusions patient.
- **FR-016**: Fournir une messagerie patient–médecin liée au suivi avec états de transmission et lecture. La demande d'appel, le contact établi et l'intervention restent des états distincts ; aucun délai de réponse garanti n'est annoncé.
- **FR-017**: Fournir une recherche sémantique sourcée sur le dossier autorisé et une bibliothèque identifiée ; l'absence de preuve doit être explicite. Une référence ne modifie pas les règles ou autorisations.
- **FR-018**: Enregistrer les actions attendues, rappels, réponses du patient et revues en retard. Le silence du médecin ne vaut jamais accord ; la lecture d'un message ne vaut pas réalisation d'une action.
- **FR-019**: Pour un rouge, montrer immédiatement le message fixe du scénario et créer une tâche urgente pour le médecin ; l'état de contact réel reste honnête, notamment hors connexion.
- **FR-020**: Identifier toute mesure connectée par source, appareil, patient associé, unité, heure de mesure et qualité. Distinguer simulateur et appareil réel ; refuser les mesures non attribuables ou invalides et dédupliquer les retransmissions.
- **FR-021**: Permettre au patient un partage externe portant sur une sélection explicite de données déjà présentes, avec expiration et révocation. L'usage unique signifie une seule activation donnant une session limitée, pas une seule requête de lecture.
- **FR-022**: Ne révéler aucune donnée et ne consommer aucun lien par simple aperçu. La session externe ne donne aucun droit de gestion médicale, d'accès général ou de modification de l'historique.
- **FR-023**: Permettre des notes externes ajoutées à l'historique avec auteur déclaré non vérifié ; corrections par nouvelle note. Elles ne deviennent pas automatiquement des conclusions confirmées et signalent un éventuel changement de contexte.
- **FR-024**: Une révocation arrête les accès futurs et opérations non terminées. Les notes déjà enregistrées restent dans le dossier ; les documents précédemment consultés ne peuvent pas être rappelés chez le destinataire.
- **FR-025**: En cas d'échec IA, préserver consultation du dossier, saisie, suivi des actions, priorités déterministes et accès aux sources. Toute sortie du modèle reste une proposition traçable.
- **FR-026**: La démonstration utilise des patients et documents fictifs et indique les profils, données d'appareil, références préparées ou canaux simulés. Ne pas annoncer une validation clinique, une connexion matérielle ou un appel vidéo qui n'ont pas été réalisés.
- **FR-027**: Sans référent ayant accepté les droits, conserver le dossier et les déclarations du patient, afficher « plan en attente de médecin » et ne pas attribuer des demandes ou alertes à une équipe inexistante. La fin d'une relation suspend ses protocoles ; un autre médecin doit les réexaminer explicitement.
- **FR-028**: Un profil précise les sources admises : une mesure saisie et contrôlée reste une déclaration patient, une mesure simulée reste simulée, une extraction IA reste candidate et une note externe reste non vérifiée. Aucun affichage ou rapport ne les transforme en faits confirmés ; seules les sources admissibles alimentent les règles.

### Key Entities *(include if feature involves data)*

- **Dossier patient** : identité stable, conditions enregistrées, historique sourcé et contrôle des accès.
- **Réponse d'onboarding et fait médical** : origine, date, affirmation/négation/incertitude, corrections et statut de vérification.
- **Profil et évaluation de suivi** : condition, contexte applicable, version, règles, couverture, preuves et priorité.
- **Proposition et plan de suivi** : éléments distincts, échéances, version et décision du médecin.
- **Protocole et application** : autorisation explicite, conditions, validité, action permise et justification de chaque répétition.
- **Épisode et intervention** : priorité, acknowledgment, messages, demande d'appel, décision et résolution distincts.
- **Rappel et réalisation** : action attendue, échéance, transmission et déclaration d'accomplissement.
- **Mesure connectée** : source matérielle ou simulation, attribution et qualité.
- **Partage et visite externe** : sélection historique, activation unique, durée, révocation, identité déclarée et notes ajoutées.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Une démonstration de cinq minutes montre dossier → proposition → validation → nouvelle mesure → priorité expliquée → décision médecin → action patient, avec accès aux sources.
- **SC-002**: Trois scénarios distincts montrent l'approbation initiale, une répétition autorisée et une répétition bloquée après changement de contexte ; chaque décision est attribuable.
- **SC-003**: Les scénarios de couverture manquante, mesure périmée, résultat non confirmé, maladie non couverte et rouge non résolu ne produisent aucun vert global rassurant.
- **SC-004**: Un médecin externe ouvre plusieurs éléments pendant sa session, ajoute une note et perd l'accès après révocation ; un second destinataire ne peut pas activer le même lien.
- **SC-005**: Une retransmission ne duplique ni mesure, ni note, ni action. Chaque mesure simulée est reconnaissable comme telle et conserve l'heure réellement simulée.
- **SC-006**: Les parcours patient et médecin sont exécutés en français ; les pages principales, erreurs et états d'attente sont vérifiés en arabe et sur un écran mobile.
- **SC-007**: L'indisponibilité du modèle et la perte de connexion n'affichent aucune approbation, transmission ou intervention fictive ; le dossier et les opérations locales autorisées restent utilisables.

## Assumptions

- **Vision et périmètre** : dossier général et profils extensibles ; preuve initiale sur des scénarios fictifs diabète/tension. Le pouls est capturé mais non classé sans profil adapté. Les autres maladies peuvent être enregistrées avec couverture explicitement inconnue.
- **Supervision** : médecin référent chargé du plan et de la réutilisation ; médecins secondaires selon droits. La démo ne constitue pas une vérification professionnelle réelle.
- **Actions répétées** : le premier protocole réutilisable concerne une consigne de mesure/suivi déjà approuvée. Aucun nouveau diagnostic, changement de dose ou prescription autonome. Les examens proposés restent à valider.
- **Appareils** : simulateur explicite pour cette démonstration ; l'intégration d'un appareil réel dépendra de son modèle et de son interface.
- **Communication** : construire d'abord une vraie messagerie dans l'application et une demande de contact. Transport audio/vidéo réel ultérieur ; une démonstration éventuelle porte la mention simulation.
- **Partage externe** : lien activable pendant 24 heures, ouvrant une session de 60 minutes au maximum avec fin après 15 minutes d'inactivité. Le destinataire est déclaré, pas vérifié. La sélection historique est figée lors de l'émission ; les nouveaux éléments ne sont pas ajoutés implicitement.
- **Recherche** : recherche dans le dossier autorisé et petite bibliothèque identifiée pour la démo, sans présentation trompeuse d'une recherche médicale exhaustive en temps réel.
- **Documents initiaux** : PDFs conservés avec leurs sources ; extraction automatique de textes lisibles, saisie/revue assistée quand le PDF est scanné ou illisible. Les photos et OCR général sont une extension ; l'interface indique honnêtement la limite plutôt qu'une extraction inexistante.
- **Langues de l'IA** : rapport généré initialement en français pour revue médecin ; interface et messages fixes approuvés FR/AR. Une traduction médicale libre ou le Darija ne sont pas présentés comme vérifiés automatiquement.
- **Sans référent** : le patient peut déposer et organiser ses données puis inviter un médecin ; aucun suivi humain n'est présumé. Les actions médicales attendent une relation acceptée et un plan activé.
- **Revue clinique** : seuils, calendriers de mesures, examens, messages et qualité des hypothèses ne sont pas validés par les tests logiciels. Les règles non revues restent des règles de démonstration sur données fictives.
- **Valeur commerciale** : cabinets et équipes suivant une cohorte de patients chroniques constituent une hypothèse de premier client ; le modèle économique fait l'objet d'une étude distincte, sans facturation dans cette refonte.

## Découpage de réalisation proposé

1. **Dossier et droits** : identité patient, historique centralisé, invitations médecins et contrôle des accès. Réutiliser le travail de conception 005 applicable, en retirant sa restriction au diabète.
2. **Boucle de suivi essentielle** : onboarding, propositions séparées, plan approuvé, évaluation par profil, rapport et messagerie.
3. **Accompagnement supervisé** : chatbot, rappels, première approbation et répétition conditionnelle avec cas de blocage.
4. **Extensions démontrables** : recherche sourcée, connecteur simulé, consultation externe à usage unique.

Chaque lot aura un contrat et des scénarios d'acceptation avant les modifications parallèles. Codex conserve backend/données/intégration ; Claude conserve frontend ; revues indépendantes après chaque lot. Cette liste constitue un ordre de conception, pas un plan d'implémentation approuvé.
