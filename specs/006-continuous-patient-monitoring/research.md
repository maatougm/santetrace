# Décisions et critiques — suivi continu du patient

Date : 2026-10-11. Conception uniquement ; aucune preuve d'implémentation ou de validation clinique.

## Entrées confirmées

- Correction utilisateur : plateforme générale de suivi, diabète utilisé comme exemple.
- Réponse utilisateur : mesures à domicile **et** examens proposés au médecin.
- Aucun appareil : connecteur simulé clairement identifié.
- Codex backend/données/intégration ; Claude frontend ; agents spécialisés et critiques des deux modèles demandés.
- Compte patient, protocoles, IA intégrée, messagerie et partage externe restent à construire ; ne pas confondre la base fonctionnelle existante et cette refonte.

## Revues Codex

Trois analyses indépendantes sans modification du code : architecture clinique/protocoles, sécurité du partage externe et valeur pour le jury. Elles convergent sur une boucle complète de suivi, une évaluation par condition avec couverture explicite, une réutilisation limitée à un protocole autorisé et un partage externe distinct d'un compte médecin.

Principales décisions :

- Une approbation unique ne crée pas une autorisation permanente. Le protocole est propre au patient et à la relation médecin active ; données inconnues, changement pertinent ou révocation suspendent son application.
- Le rouge reste ouvert jusqu'à une résolution explicite ; envoi, lecture, acknowledgment, action réalisée et résolution sont distincts.
- Une tension récente ne masque pas une glycémie périmée. Une maladie sans profil ne devient pas verte.
- Le lien externe est une seule activation, puis une session courte. Les aperçus ne le consomment pas ; notes ajoutées avec identité déclarée non vérifiée et historique préservé.

## Revue Claude Code

Rapport complet : [claude-continuous-care-design-review.md](../../docs/claude-continuous-care-design-review.md). Exécution de revue en lecture seule terminée, cinq tours, résultat reçu ; aucun code écrit par cette revue.

| Constat | Décision dans la spécification |
| --- | --- |
| Aucun médecin défini pour approuver quand le patient s'inscrit seul | Ajout du cas sans référent : dossier conservé, plan en attente, aucun suivi humain présumé. |
| Sources patient/simulation/extraction/note externe confondues | Provenance conservée, sources admissibles définies par profil, candidats et notes non vérifiées exclus des faits confirmés. |
| Nouveaux examens exposés avant revue | Patient voit attente et éléments à compléter ; l'examen ne devient action qu'après décision du médecin. |
| Onboarding et uploads trop exigeants | Onboarding progressif, réponses inconnues, informations manquantes explicites ; PDFs scannés conservés avec recours à saisie/revue, sans promesse d'OCR général. |
| Réponse humaine et appel interprétés comme garantis | Messagerie réelle et demande de contact ; aucun appel connecté ou délai garanti sans transport réel. |
| Exemple de réutilisation Claude montrant le même protocole chez plusieurs patients | Rejet : premier protocole strictement propre au même patient ; la démonstration montre plusieurs événements chez ce patient, pas une autorisation transférée. |
| Recommandation de remplacer l'inscription et le consentement par des données préchargées | Rejet comme fonctionnalité cible : l'utilisateur demande une plateforme patient autonome. Données fictives préchargées possibles pour accélérer la narration, sans masquer les parcours à construire. |
| Recommandation de couper les hypothèses médicales | Maintien des hypothèses comme brouillon réservé au médecin, conformément au besoin corrigé ; aucune conclusion patient, prescription ou diagnostic automatique. Les anciens périmètres ne les autorisaient pas. |
| Recherche sur littérature trop vaste | Petite bibliothèque identifiée et dossier autorisé ; pas de recherche exhaustive ou recommandation autonome. |

## Gouvernance et sources

La correction directe de l'utilisateur remplace le scope historique 005. Les anciens plans 003/004/005 restent des références, pas une autorisation d'exécuter des fonctionnalités nouvelles. La décision médicale reste humaine ; l'IA propose des informations ou hypothèses à examiner, sans établir de diagnostic.

Le principe de contrôle humain et de transparence s'appuie sur [l'OMS](https://www.who.int/news/item/28-06-2021-who-issues-first-global-report-on-ai-in-health-and-six-guiding-principles-for-its-design-and-use). Cela ne détermine ni validation clinique, ni conformité tunisienne de l'application.

L'étude du modèle économique est distincte : [hackcure-business-model.md](../../docs/hackcure-business-model.md). Prix et gains de productivité doivent rester des hypothèses à tester ; une validation de proposition dans le prototype ne constitue pas une ordonnance électronique ou une autorisation de pratique à distance.

## Décisions techniques du plan approuvé en périmètre

Le 2026-10-11, l'utilisateur a répondu « Oui, prépare le plan Codex + Claude ». Deux analyses Codex en lecture seule ont inspecté stockage/évaluation/worker et IA/sources ; Claude Code a terminé une proposition frontend en lecture seule. [Rapport frontend Claude](../../docs/claude-continuous-care-frontend-plan.md). Cette preuve porte sur la conception, pas sur des fonctionnalités réalisées.

| Décision | Raisonnement | Alternatives examinées |
| --- | --- | --- |
| Étendre CareStore SQLite et ses IDs existants | Préserve dossiers, sources privées, historique et rejeu déjà testables ; migration v2 sauvegardée et répétable | Repartir de zéro ou déplacer vers Supabase ajouterait une migration sans besoin du scénario local. |
| Évaluer chaque condition puis agréger couverture/priorité | La mesure la plus récente parmi tous les types masque actuellement une autre mesure périmée ; un rouge ouvert doit dominer | Moyenne de scores et classification libre par LLM ne conservent pas ces garanties. Les règles hautes existantes n'ont pas de couverture basse complète : limite affichée. |
| Figé : contexte clinique/autorité/plan/profil ; renouvelé : preuve de mesure | Un protocole peut revoir un nouvel événement sans bloquer toutes les répétitions après la première mesure | Figer la révision de mesure initiale rendrait toute nouvelle application impossible ; similarité seule ne donne pas d'autorité. |
| Worker Node indépendant, 15 s de cadence démo/60 s de bail | Le suivi continue sans page ouverte ; reprises et deux workers se testent sur le même store | Minuteries Next/page et queue externe évitées. Les I/O asynchrones restent hors transaction synchrone. |
| Adapter local de génération/embedding, sorties structurées et sources validées | Modèles déjà disponibles ; faits rendus par le serveur et hypothèses limitées aux codes sourcés du registre | Appels cloud non configurés, framework d'agents, texte diagnostique libre ou nouvelle base vectorielle inutiles. Les réponses sans preuve échouent avec repli déterministe. |
| Cache de vecteurs privé, filtrage courant avant classement et libération | Une autorisation ancienne ne peut pas survivre dans l'index | Partition par ancien droit seule serait périmée après révocation. Recherche lexicale explicite si modèle absent. |
| Session externe distincte, une activation et sélection figée | Plusieurs lectures sont nécessaires à une consultation ; une déclaration n'est pas une identité médicale vérifiée | Compte invité assimilé à un médecin, lien réutilisable illimité et consommation par aperçu rejetés. |
| Un seul transport frontend, modules API/copie par lot et fence commun | api.ts et i18n.ts sont déjà volumineux ; réutiliser runtimes et purge existants limite les collisions | Un second runtime/session, DTOs frontend indépendants et cache de dossier élargi rejetés. |

## Arbitrages de la proposition frontend Claude

- Délai client IA : 45 s, avec budget de génération serveur 30 s ; remplace sa proposition de 30 s côté client. Appels ordinaires 15 s et PDF 60 s conservés.
- Révision d'accès : `AccessEnvelope.authorityRevision` monotone ; clé acteur/patient et epoch commun aux polls et opérations ponctuelles. Pas de promesse d'effacement en deux secondes non mesurée : prochain contrôle serveur et réponse retenue rejetée.
- Propositions en attente côté patient : `{id,revision,kind,state}` seulement. Ni examen non approuvé, ni paramètres d'action, ni hypothèse dans ce DTO.
- Refus invité : `404 VISIT_UNAVAILABLE` neutre pour lien/session inaccessible, au lieu de différents codes révélant l'état du secret. Fin explicite via DELETE session.
- Réponses assistant : union explicite record_answer/approved_action/needs_clinician/unavailable. Questions fixes de dossier séparées du texte médical libre ; « transmis » exige un message réellement enregistré et un destinataire autorisé.
- Lecture de message, revue clinique et nouvelle autorisation de protocole sont trois événements séparés. La revue seule ne réactive pas un protocole suspendu.
- Plan UI : suivre les routes et noms des sous-plans canoniques, conserver les URLs existantes et importer les types serveur partagés. Le rapport Claude reste une proposition, pas un contrat concurrent.

Les décisions et DTOs détaillés sont dans [plan.md](plan.md), [data-model.md](data-model.md) et [contracts/api.md](contracts/api.md). Les API Ollama officielles consultées sont [generate](https://docs.ollama.com/api/generate) pour format JSON/schema et stream=false, et [embed](https://docs.ollama.com/api/embed) pour vecteurs et truncate=false. Aucun point technologique ne reste à clarifier pour préparer les lots ; la relecture utilisateur du plan concret précède l'implémentation.
