# Santetrace — livraison après vérification complète

Vérification du 11 octobre 2026. La version locale active utilise le build `zH_ubJNmhpfcFfuQGSPvo`. Le serveur web et le service de suivi exécutent la même version, avec conservation du dossier et des sessions de démonstration.

## Résultats techniques

- **952 tests automatisés réussis**, aucun échec, aucun test ignoré.
- Compilation de production Next.js avec webpack et vérification TypeScript réussies.
- Revue indépendante des dernières corrections : **200 tests ciblés réussis**, aucune anomalie confirmée dans les 16 fichiers revus.
- Tests navigateur sur des dossiers synthétiques séparés du dossier de démonstration. Les modèles étaient désactivés pendant ces tests : ils vérifient les parcours et les protections du logiciel, pas la qualité médicale d’un modèle.
- En production locale, la session médecin, le dossier fictif existant, son estimation enregistrée de 70/100 et les notifications WebSocket ont été conservés. Le service de suivi a terminé plusieurs cycles successifs sans échec et produit un signal récent.

## Corrections vérifiées par des clics réels

| Problème | Comportement corrigé |
|---|---|
| Fermeture d’une fenêtre de revue | Échap et Annuler rendent le focus au bouton d’origine et effacent le brouillon du motif. |
| Confirmation retirant le bouton d’origine | Le focus revient au même message revu. Pendant l’envoi, les protections contre la fermeture restent actives. |
| Rappels de mesures décrits comme des prises de médicament | Les titres et instructions distinguent une déclaration de prise et une action du plan. |
| Rapport contenant des identifiants techniques | Les libellés sont lisibles, avec conservation des valeurs, unités, dates et sources. |
| Données non partagées présentées comme des zéros | L’interface distingue une donnée non accessible et un zéro réellement connu. |
| Retrait du consentement perdu après rechargement | L’état retiré et la proposition de nettoyage persistent ; les refus du serveur restent effectifs. |
| Historique d’une déclaration corrigée absent | Le patient autorisé retrouve les anciennes versions ; les entrées médicales courantes des modèles restent filtrées. |
| Réexamen d’une proposition imposant une nouvelle sélection inutile | L’action existante est préremplie ; la justification et l’approbation séparée restent obligatoires. |
| Section du dossier difficile à atteindre sur téléphone | Un bouton nommé rejoint la section actuelle et y place le focus clavier. |
| Estimation IA absente sans explication visible | La raison réelle apparaît dans la file, y compris pour un accès limité. |

Les parcours exercés couvrent l’inscription et les déclarations du patient, les mesures, les documents PDF et leur confirmation, les droits et leur révocation, les plans et protocoles, les rappels, les alertes, la messagerie, les demandes de contact, la recherche et le rapport, les tendances, l’export, le partage externe et le simulateur d’appareil. Les contrôles d’accès et les demandes devenues obsolètes ont aussi été exercés.

## Interface et téléphone

L’interface conserve la marque Santetrace et reprend des principes de lisibilité et de tâches explicites du [NHS Design System](https://service-manual.nhs.uk/design-system/design-principles) et du [NHS App](https://design-system.nhsapp.service.nhs.uk/patterns/the-structure-of-the-nhsapp/). Aucune affiliation n’est revendiquée.

Les vues principales ont été vérifiées en français et en arabe, à 320, 390, 768 et 1440 pixels, avec un contrôle de redistribution à 720 pixels CSS. Les corrections finales disposent de 42 captures : aucun débordement horizontal ni exception navigateur observés. La navigation du dossier ne charge pas les messages en arrière-plan. Les textes cliniques conservent leur langue d’origine.

## Limites de cette vérification

Ces résultats portent sur les parcours décrits et les données fictives utilisées. Ils ne prouvent pas une validation clinique, une conformité réglementaire ou le fonctionnement pour tous les cas médicaux. Les nouveaux appels aux fournisseurs de modèles n’ont pas été évalués dans cette campagne. La chaîne IoT sur matériel réel, les appels audio/vidéo, l’OCR général et le diagnostic d’imagerie ne sont pas validés par ces essais. Le démarrage à froid hors connexion, toutes les branches temporelles d’expiration et de quota des protocoles, une revue linguistique arabe et une campagne complète avec lecteur d’écran restent à vérifier.

La présentation et la génération vidéo sont toujours en pause ; elles ne font pas partie de cette livraison logicielle.
