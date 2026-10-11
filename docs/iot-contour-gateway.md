# SanteTrace — passerelle ESP32 et glucomètre Bluetooth

État : logiciel de passerelle implémenté ; compilation et validation logicielle documentées ci-dessous. Aucun glucomètre ni ESP32 physique n'a été fourni. La compatibilité radio du Contour Next One n'est donc **pas vérifiée**. Le simulateur de l'application reste identifié comme simulation.

## Architecture et contrat réel

```text
Glucomètre dédié à un patient
  → Bluetooth Glucose Service vérifié sur le matériel
  → ESP32 : association authentifiée, décodage, file LittleFS persistante
  → HTTPS + jeton du connecteur
  → POST /api/connectors/events
  → ConnectorService : consentement, liaison, validation, idempotence
  → mesure source=device, horodatage original, priorité déterministe
  → WebSocket d'invalidation → patient et médecin relisent leurs données autorisées
```

La passerelle utilise le backend SQLite/HTTP/WebSocket de l'application existante. Elle ne crée ni base Supabase ni abonnement cloud. Le jeton du connecteur appartient à une seule liaison appareil/patient et n'accorde pas l'accès au dossier médical.

Le corps envoyé est exactement :

```json
{
  "externalEventId": "ble-glucose:<empreinte>:<epoch>:<sequence>:<date-base>:<offset-capteur>",
  "measuredAt": "2026-10-11T07:30:00.000Z",
  "reading": { "kind": "glucose", "value": 120, "unit": "mg/dL" },
  "quality": "accepted"
}
```

`Authorization: Bearer <jeton>` est transmis uniquement à l'hôte HTTPS configuré. Le certificat est vérifié avec une autorité racine fournie lors du provisionnement ; les redirections sont désactivées. Le micrologiciel ne journalise ni jeton, ni PIN, ni valeur de glycémie, ni identité du patient.

## Matériel nécessaire et première vérification

Il faut le glucomètre avec ses consommables, un ESP32 DevKitC compatible avec la cible `esp32dev`, un câble USB de données et un réseau Wi-Fi. Un téléphone avec un inspecteur BLE permet de relever le profil réel du glucomètre avant de flasher la passerelle.

1. Vérifier sur **l'appareil réel** le service `0x1808`, la notification de mesure `0x2A18`, le contexte facultatif `0x2A34`, et le contrôle RACP `0x2A52` avec écriture/indication. Le simple logo Bluetooth ne prouve pas ce profil.
2. Relever l'adresse Bluetooth et son type public/statique aléatoire ; confirmer le numéro de série qui sera la valeur `deviceId` de la liaison SanteTrace. Le code filtre le service et l'adresse, puis vérifie l'identité BLE après association chiffrée et authentifiée.
3. Vérifier le mode d'association et fournir le PIN réellement demandé par ce glucomètre. Les confirmations numériques non supervisées sont refusées. Le PIN `123456` de l'exemple est une valeur fictive, pas le PIN de votre appareil.
4. Confirmer que les enregistrements demandés appartiennent au patient. Choisir `firstSequence` pour exclure toute ancienne mesure d'un précédent utilisateur. Ne pas réaffecter un glucomètre contenant l'historique d'un autre patient sans gérer ce périmètre.
5. Vérifier l'horloge et le décalage de fuseau applicable aux mesures historiques. Une valeur historique provenant d'une période avec un autre décalage saisonnier doit être traitée séparément ; le micrologiciel utilise un décalage UTC explicite, pas une base de règles de fuseau.

Si le profil utilise un protocole propriétaire, une adresse privée tournante non résolue, un autre mode d'association ou une caractéristique différente, cette version s'arrête ; il faudra adapter et retester le matériel concerné. Ne pas présenter cette étape comme acquise.

## Décodage et qualité

Les octets sont interprétés en little-endian. Le `SFLOAT` a une mantisse signée de 12 bits et un exposant signé de 4 bits. Les valeurs spéciales, une concentration absente, des champs tronqués, des octets supplémentaires et les bits réservés sont rejetés. Les conversions dépendent du bit d'unité : **kg/L × 100 000 → mg/dL**, ou **mol/L × 1 000 → mmol/L**. Aucune valeur n'est arrondie à une limite médicale.

Le temps du capteur est `Base Time + Time Offset` ; le `Time Offset` est signé et exprimé en minutes. Il ne représente pas le fuseau horaire. Le premier paquet d'une procédure doit fournir ce décalage ; les suivants peuvent hériter de la valeur déjà reçue dans cette même procédure. L'horloge déclarée inconnue ou défectueuse est rejetée ; elle n'est jamais remplacée par l'heure d'arrivée réseau. Le fuseau explicitement vérifié transforme ensuite l'heure civile du capteur en UTC.

Les solutions de contrôle et les types/sites réservés sont refusés. Les prélèvements capillaires sang total/plasma au doigt sans avertissement sont admissibles au chemin normal. Les autres échantillons valides, avertissements capteur et mesures nécessitant un contexte non conservé par le contrat actuel deviennent `suspect`. Le contexte est attendu et associé au même numéro de séquence ; un contexte manquant reste suspect. Une discordance de séquence ou un contexte malformé stoppe la capture. Le backend exclut les mesures suspectes de l'évaluation normale ; cette validation logicielle ne constitue pas une validation clinique du produit.

Les trois abonnements sont établis **avant** la requête RACP. La requête lit les enregistrements à partir du dernier numéro acquitté, inclusivement, pour permettre un replay sûr. La réception est considérée complète uniquement après l'indication RACP de succès ou d'absence d'enregistrement.

## Identifiants, panne réseau et acquittement

L'identifiant stable est `ble-glucose:<16 premiers caractères SHA-256 de meterIdentity>:<epoch>:<sequence>:<YYYYMMDDTHHMMSS de Base Time>:<Time Offset effectif>`. Le fuseau choisi et l'heure de transmission ne participent pas à cet identifiant. `epoch` est une valeur manuelle de 1 à 8 caractères alphanumériques, `_` ou `-`, à changer après une remise à zéro du compteur ou un changement de cycle du matériel. Le standard interdit un rollover normal du compteur ; la passerelle n'en invente pas une interprétation automatique.

Chaque événement est d'abord enregistré dans LittleFS, avec son corps JSON et sa liaison. Les répétitions reprennent exactement ce corps. L'écriture utilise un fichier temporaire, vérification par relecture puis renommage. La file est limitée à 128 événements et ne supprime pas silencieusement d'ancienne mesure lorsqu'elle est pleine. Une saturation suspend la capture ; les événements persistants peuvent être transmis avant le prochain transfert BLE. Une saturation de la file radio ferme immédiatement l'admission, le traitement et l'avancement du checkpoint, puis met la passerelle en quarantaine persistante. Les événements déjà enregistrés restent conservés, sans acquittement supplémentaire ; une reprise nécessite une revue opérateur et une nouvelle transmission sans perte. Les 512 places de réception ne garantissent pas la capacité de tout glucomètre.

Un code HTTP 2xx seul ne suffit pas. L'acquittement vérifie dans le reçu l'identifiant, l'heure, la valeur, l'unité, la qualité, `source=device`, `simulated=false` et le même appareil. Le checkpoint NVS avance uniquement après ce reçu vérifié, puis le fichier est supprimé. Identité de liaison et progression sont sauvegardées ensemble dans un unique blob NVS atomique, avec version et contrôle d'intégrité ; elles ne peuvent pas être remplacées séparément. Une coupure entre l'acquittement et la suppression retransmet le même identifiant, que le serveur déduplique.

Les erreurs réseau, HTTP 408/429/5xx entraînent un délai progressif plafonné à 60 secondes avec jitter. Les refus 401/403/404 bloquent le connecteur ; un conflit 409 ou un autre refus de validation met la file en quarantaine sans altérer les valeurs. Un reçu invalide, une erreur de stockage, une erreur de décodage ou une association incorrecte stoppe aussi la capture. La quarantaine est persistante et nécessite une revue opérateur.

Les limites actuellement admises par l'API sont 20–600 mg/dL ou 1–33,4 mmol/L. Une valeur hors de cette plage n'est pas ramenée artificiellement dans la plage ; le refus conserve l'événement pour examen. L'extension du contrat pour les valeurs extrêmes et le contexte médical complet est un travail produit distinct.

## Compilation et provisionnement

Sources : [micrologiciel](../firmware/contour-gateway/src/main.cpp), [décodeur](../firmware/contour-gateway/include/glucose_decoder.h), [test hôte](../firmware/contour-gateway/tests/decoder_test.cpp), [configuration fictive](../firmware/contour-gateway/config.example.json).

La cible est épinglée à PlatformIO 6.1.18, Espressif32 6.12.0, Arduino ESP32 2.0.17, NimBLE-Arduino 2.3.7 et ArduinoJson 7.4.2. Depuis `firmware/contour-gateway` :

```sh
python3 -m venv .tools/venv
.tools/venv/bin/pip install platformio==6.1.18
.tools/venv/bin/pio run -j 2
clang++ -std=c++17 -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -I include tests/decoder_test.cpp -o tests/decoder-test
tests/decoder-test
clang++ -std=c++17 -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -pthread -I include tests/transport_test.cpp -o tests/transport-test
tests/transport-test
```

Pour un **nouvel ESP32 vide uniquement**, téléverser le micrologiciel et une image LittleFS initiale :

```sh
.tools/venv/bin/pio run -t upload
.tools/venv/bin/pio run -t buildfs
.tools/venv/bin/pio run -t uploadfs
```

`uploadfs` écrase la partition de données : ne pas l'exécuter sur une passerelle contenant des événements en attente. Le firmware n'effectue jamais de formatage automatique.

Créer dans l'application une liaison réelle `kind=device`, récupérer le jeton à usage d'affichage unique, puis copier `config.example.json` vers `config.local.json` (ignoré par Git). Compléter les paramètres réels, fournir le certificat CA de votre hôte, vérifier l'heure et la propriété de l'historique avant de mettre les deux attestations à `true`. `meterIdentity` doit être exactement le `deviceId` de la liaison créée.

Le certificat CA PEM est limité à 3 000 octets et le JSON de configuration compact complet à 3 800 octets, afin de respecter la limite des chaînes NVS de cette version ESP32. Le poste de démonstration `http://127.0.0.1:3012` n'est pas un hôte HTTPS accessible depuis un ESP32. Prévoir un hôte TLS accessible sur le réseau avec un certificat validable, ou un déploiement HTTPS réel. Aucune publication réseau n'a été faite par ce travail.

Après le démarrage normal du firmware, presser brièvement **BOOT** dans les 90 premières secondes pour ouvrir le provisionnement USB. Ne pas maintenir BOOT pendant une remise sous tension : cela lance le chargeur ESP32. Envoyer une seule ligne `PROVISION ` suivie du JSON compact depuis une connexion USB de confiance, sans écho ni enregistrement de secrets. Le programme ne répète pas la ligne. Un provisionnement est refusé si la file contient des événements ; il ne peut pas envoyer les mesures d'une ancienne liaison vers un nouveau patient.

En cas de quarantaine avec événements en attente, conserver/exporter la partition en local et faire examiner ces événements avant toute remise à zéro. Ne pas les vider simplement pour faire disparaître une erreur. Le prototype conserve le jeton et le Wi-Fi en NVS, et les mesures en LittleFS sans chiffrement applicatif : avant un usage réel, activer Secure Boot et Flash Encryption/NVS Encryption selon le déploiement ESP32 et valider la récupération sécurisée.

## Résultats et critères d'acceptation

- Test C++ hôte : **62 assertions passées**, avec AddressSanitizer et UndefinedBehaviorSanitizer ; unités, horodatages, héritage d'offset, champs spéciaux, contrôle, bits réservés, contexte, identifiants et dates.
- Test C++ transport : **229 assertions passées**, avec les mêmes sanitizers ; changement de liaison avec coupure avant/après sauvegarde, fichier corrompu, interdiction de changer de patient avec mesures en attente, arrêt après perte de notification et visibilité entre threads.
- Compilation PlatformIO ESP32 : **réussie**. Programme : 1 273 125 octets (97,1 % de la partition application), RAM statique : 56 608 octets (17,3 %). La file radio est allouée dynamiquement ; ces nombres ne prouvent pas la stabilité mémoire sur un appareil réel. Le binaire et les tailles finales sont consignés dans `firmware/contour-gateway/build-evidence.json`.
- Test radio, association et Wi-Fi sur ESP32 réel : **non effectué**, matériel absent.
- Profil réel du Contour Next One : **non vérifié**.
- Un replay d'octets synthétiques est une preuve logicielle, pas une mesure patient réelle ; les essais utilisent une base et une identité fictives isolées.

Avant de dire « connecté au glucomètre », il faut obtenir une mesure réelle de l'appareil vérifié, tester une coupure Wi-Fi et un redémarrage, constater une seule mesure persistée avec sa date d'origine, tester la révocation, puis retrouver la même mesure dans les vues patient et médecin. Les tests logiciels ne remplacent pas ce passage matériel.

## Sources techniques primaires

- [Bluetooth SIG — Glucose Service v1.0.1](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/GLS_v1.0.1/out/en/index-en.html).
- [Bluetooth SIG — GATT Specification Supplement, §3.119](https://btprodspecificationrefs.blob.core.windows.net/gatt-specification-supplement/GATT_Specification_Supplement.pdf).
- [NimBLE-Arduino — exemple Client 2.3.7](https://github.com/h2zero/NimBLE-Arduino/blob/2.3.7/examples/NimBLE_Client/NimBLE_Client.ino).
- [PlatformIO — Espressif32](https://docs.platformio.org/en/latest/platforms/espressif32.html).
- [Espressif — Flash Encryption](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/security/flash-encryption.html).
- [Espressif — NVS, contraintes et récupération après perte d'alimentation](https://docs.espressif.com/projects/esp-idf/en/v4.4.8/esp32/api-reference/storage/nvs_flash.html).
