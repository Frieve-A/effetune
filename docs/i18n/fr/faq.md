---
title: "FAQ et dépannage - EffeTune"
description: "Questions fréquentes et guide de dépannage pour le processeur audio Frieve EffeTune."
lang: fr
---

# FAQ EffeTune

EffeTune est une application DSP en temps réel pour les passionnés d'audio disponible en version web et en application de bureau. Ce document couvre la configuration, le dépannage, l'utilisation multicanal, le fonctionnement des effets et la correction de fréquence.

## Contenu
1. Configuration initiale pour le streaming
   1.1. Installation de VB-CABLE et utilisation du 96 kHz
   1.2. Entrée du service de streaming (exemple Spotify)
   1.3. Paramètres audio d'EffeTune
   1.4. Vérification du fonctionnement
2. Dépannage
   2.1. Qualité de lecture audio
   2.2. Utilisation du CPU
   2.3. Écho
   2.4. Problèmes d'entrée, de sortie ou d'effets
   2.5. Discordance de sortie multicanal
3. Connexions multicanal et matérielles
   3.1. HDMI + récepteur AV
   3.2. Interfaces sans pilotes multicanaux
   3.3. Retard de canal et alignement temporel
   3.4. Limite de 8 canaux et expansion
4. Questions fréquemment posées
5. Réponse en fréquence et correction acoustique
6. Conseils d'utilisation des effets
7. Liens de référence

---

## 1. Configuration initiale pour le streaming

Exemple Windows : Spotify → VB-CABLE → EffeTune → DAC/AMP. Les concepts sont similaires pour d'autres services et systèmes d'exploitation.

### 1.1. Installation de VB-CABLE et activation du 96 kHz
Téléchargez le pack de pilotes VB-CABLE, exécutez `VBCABLE_Setup_x64.exe` en tant qu'administrateur et redémarrez. Rétablissez la sortie par défaut du système d'exploitation vers vos haut-parleurs/DAC et définissez les formats **CABLE Input** et **CABLE Output** sur 24 bits, 96 000 Hz. Lancez `VBCABLE_ControlPanel.exe` en tant qu'administrateur, choisissez **Menu▸Fréquence d'échantillonnage interne = 96000 Hz**, puis cliquez sur **Redémarrer le moteur audio**.

### 1.2. Routage du service de streaming (exemple Spotify)
Ouvrez **Paramètres▸Système▸Son▸Mélangeur de volume**, et définissez la sortie de `Spotify.exe` sur **CABLE Input**. Lisez une piste pour confirmer l'absence de son provenant des haut-parleurs.
Sous macOS, utilisez **SoundSource** de Rogue Amoeba pour affecter la sortie de Spotify à **CABLE Input** de la même façon.

### 1.3. Paramètres audio d'EffeTune
Lancez l'application de bureau et ouvrez **Configuration audio**.
- **Périphérique d'entrée :** CABLE Output (VB-Audio Virtual Cable)
- **Périphérique de sortie :** DAC/Haut-parleurs physiques
- **Fréquence d'échantillonnage :** 96 000 Hz (des taux inférieurs peuvent dégrader la qualité)

### 1.4. Vérification du fonctionnement
Avec Spotify en lecture, basculez le bouton principal **ON/OFF** dans EffeTune et confirmez que le son change.

---

## 2. Dépannage

### 2.1. Problèmes de qualité de lecture audio

| Symptôme | Solution |
| ------ | ------ |
| Coupures ou accrocs | Cliquez sur le bouton **Reset Audio** dans le coin supérieur gauche de l'application web ou choisissez **Reload** dans le menu **View** de l'application de bureau. Réduisez le nombre d'effets actifs si nécessaire. |
| Distorsion ou écrêtage | Insérez **Level Meter** à la fin de la chaîne et maintenez les niveaux en dessous de 0 dBFS. Ajoutez **Brickwall Limiter** avant Level Meter si nécessaire. |
| Aliasing au-dessus de 20 kHz | VB-CABLE fonctionne peut-être toujours à 48 kHz. Revérifiez la configuration initiale. |

### 2.2. Utilisation élevée du CPU
Désactivez les effets que vous n'utilisez pas ou retirez-les de l'**Effect Pipeline**.

### 2.3. Écho
Vos périphériques d'entrée et de sortie peuvent être en bouclage. Assurez-vous que la sortie d'EffeTune ne revient pas à son entrée.

### 2.4. Problèmes d'entrée, de sortie ou d'effets

| Symptôme | Solution |
| ------ | ------ |
| Pas d'entrée audio | Assurez-vous que le lecteur envoie sa sortie vers **CABLE Input**. Autorisez la permission du microphone dans le navigateur et sélectionnez **CABLE Output** comme périphérique d'entrée. |
| L'effet ne fonctionne pas | Confirmez que le maître, chaque effet et toute **Section** sont sur **ON**. Réinitialisez les paramètres si nécessaire. |
| Pas de sortie audio | Pour l'application web, vérifiez que les sorties du système d'exploitation et du navigateur pointent vers votre DAC/AMP. Pour l'application de bureau, vérifiez le périphérique de sortie dans **Configuration audio**. |
| D'autres lecteurs signalent "CABLE Input en cours d'utilisation" | Assurez-vous qu'aucune autre application n'utilise **CABLE Input**. |

### 2.5. Discordance de sortie multicanal
EffeTune produit les canaux dans l'ordre 1→2→…→8. Si Windows est configuré pour 4 canaux, les canaux arrière peuvent être mappés sur le centre/sub. **Solution de contournement :** configurez le périphérique en 7.1ch, sortez 8ch depuis EffeTune, et utilisez les canaux 5 et 6 pour l'audio arrière.

---

## 3. Connexions multicanal et matérielles

### 3.1. HDMI + récepteur AV
Configurez la sortie HDMI de votre PC en 7.1ch et connectez-la à un récepteur AV. EffeTune peut envoyer jusqu'à 8 canaux via un seul câble. Les récepteurs plus anciens peuvent dégrader la qualité sonore ou remapper les canaux de manière inattendue.

### 3.2. Interfaces sans pilotes multicanaux (ex. MOTU M4)
Out 1‑2 et Out 3‑4 apparaissent comme des périphériques séparés, empêchant la sortie sur 4 canaux. Solutions de contournement :
- Utilisez **Voicemeeter** pour fusionner les canaux via ASIO.
- Utilisez **ASIO Link Pro** pour exposer un périphérique virtuel à 4 canaux (avancé).

### 3.3. Retard de canal et alignement temporel
Utilisez **MultiChannel Panel** ou **Time Alignment** pour retarder les canaux par pas de 10 µs (minimum 1 échantillon). Pour les grands retards, retardez les canaux avant de 100-400 ms. La synchronisation vidéo doit être ajustée côté lecteur.

### 3.4. Limite de 8 canaux et expansion
Les pilotes de système d'exploitation actuels prennent en charge jusqu'à 8 canaux. EffeTune peut prendre en charge plus de canaux lorsque les systèmes d'exploitation le permettront.

---

## 4. Questions fréquemment posées

| Question | Réponse |
| ------ | ------ |
| Sur quels appareils la version PWA fonctionne-t-elle ? | Elle peut être utilisée sur les principaux environnements mobiles et de bureau : smartphones et tablettes Android, iPhone/iPad, Windows, macOS, Linux et ChromeOS. Comme il s'agit d'une PWA, elle s'exécute dans le navigateur plutôt que comme une application native propre à chaque appareil. En revanche, la méthode d'installation, la sélection des périphériques audio d'entrée/sortie et les formats musicaux pris en charge dépendent du navigateur et du système d'exploitation. |
| Je n'arrive pas à installer la version PWA | Utilisez le bouton **Installer la version PWA** du site EffeTune, ou, dans la version web, ouvrez le menu **Paramètres** en forme d'engrenage en haut à droite et choisissez **Installer l'application**. Si l'option n'apparaît pas, ouvrez EffeTune avec Chrome, Edge ou un autre navigateur Chromium sur Android ou sur ordinateur. Sur iPhone/iPad, ouvrez le site dans Safari, puis ajoutez-le à l'écran d'accueil depuis le menu de partage. Les navigateurs intégrés aux applications, la navigation privée et les anciens navigateurs peuvent ne pas afficher l'option d'installation. |
| Entrée surround (5.1ch, etc.) ? | L'API Web Audio limite l'entrée à 2 canaux. La sortie et les effets prennent en charge jusqu'à 8 canaux. |
| Longueur recommandée de la chaîne d'effets ? | Utilisez autant d'effets que votre CPU permet sans causer de coupures ou de latence élevée. |
| Comment obtenir la meilleure qualité sonore ? | Utilisez 96 kHz ou plus, commencez avec des réglages subtils, surveillez la marge avec **Level Meter**, et ajoutez **Brickwall Limiter** si nécessaire. |
| Fonctionne-t-il avec n'importe quelle source ? | Oui. Avec un périphérique audio virtuel, vous pouvez traiter le streaming, les fichiers locaux ou l'équipement physique. |
| Puis-je utiliser uniquement le lecteur de fichiers musicaux sans entrée audio ? | Oui. Si le son du microphone revient dans vos écouteurs ou votre casque après le démarrage, ouvrez **Configuration audio**, puis, dans **Périphérique d'entrée :**, sélectionnez **Aucun (lecteur de fichiers musicaux uniquement)**. EffeTune maintient alors la chaîne d'effets avec une source silencieuse, afin que le lecteur et les effets générateurs de signal comme **Oscillator** continuent de fonctionner. Si vous sélectionnez une entrée audio, vous pouvez traiter le son d'un appareil externe connecté via une interface audio USB ou vérifier le signal entrant avec **Spectrum Analyzer**, par exemple. |
| L'application web mobile peut-elle traiter le son d'autres applications ? | En général, non. Les navigateurs mobiles ne fournissent pas d'entrée de bouclage générique pour l'audio des autres applications. Sur mobile, EffeTune s'utilise donc surtout avec son lecteur intégré. |
| Quels formats de fichiers musicaux sont pris en charge ? | Cela dépend des capacités de décodage audio du navigateur et du système d'exploitation. En pratique, MP3, WAV et AAC/M4A sont largement pris en charge ; FLAC, OGG/Vorbis et Opus/WebM varient davantage selon l'environnement. EffeTune peut aussi lire la piste audio d'un fichier MP4 sans afficher la vidéo ; la compatibilité dépend du codec audio interne, AAC étant le choix compatible le plus courant. Si un fichier ne se lit pas, essayez MP3, AAC/M4A ou WAV. |
| Puis-je lire plusieurs fichiers musicaux ? | Oui. Utilisez **Ouvrir des fichiers musicaux**, puis sélectionnez plusieurs fichiers dans la boîte de sélection standard de votre appareil avant de les ouvrir ; ils seront chargés comme liste de lecture. La sélection multiple ou la sélection de tous les fichiers d'un dossier dépend de l'appareil, du navigateur et du sélecteur de fichiers. |
| À quoi sert la Bibliothèque musicale ? | La Bibliothèque musicale indexe les dossiers musicaux sélectionnés afin de parcourir et rechercher par morceau, album, artiste, genre ou sous-dossier, puis de lire les résultats dans EffeTune. Les métadonnées de bibliothèque et les listes de lecture sont enregistrées dans l'application, pas dans les fichiers audio. |
| Où la Bibliothèque musicale est-elle disponible ? | L'application de bureau dispose de l'analyse complète des dossiers. Les navigateurs Chromium utilisent File System Access lorsque c'est disponible. Safari et Firefox utilisent une importation de secours ; il peut donc être nécessaire de resélectionner les dossiers ou fichiers après un rechargement ou une perte d'autorisation. |
| Comment actualiser ou reconnecter les dossiers de la Bibliothèque musicale ? | Utilisez **Analyser à nouveau** après avoir ajouté, supprimé ou modifié des fichiers. Si un dossier indique que l'accès manque, utilisez son bouton **Reconnecter** et autorisez de nouveau l'accès au même dossier. |
| Quels formats de listes de lecture la Bibliothèque musicale peut-elle importer ou exporter ? | La Bibliothèque musicale peut importer des listes M3U, M3U8, PLS et XSPF, et exporter des listes M3U8 ou XSPF. |
| La Bibliothèque musicale modifie-t-elle mes fichiers audio ? | Non. L'analyse, la lecture des métadonnées, le cache des pochettes, la modification des listes de lecture et la lecture restent dans l'application et ne modifient jamais les fichiers audio sur le disque. |
| Je ne peux pas sélectionner le périphérique de sortie dans l'application web | Cela dépend du navigateur et des autorisations. Essayez depuis une page sécurisée dans Chrome/Chromium, ou définissez le DAC/AMP souhaité comme sortie par défaut dans le système d'exploitation ou dans le navigateur. |
| Les valeurs **Fréquence d'échantillonnage :** ou **Canaux de sortie :** ne sont pas appliquées | Certains navigateurs ou périphériques arrondissent les valeurs non prises en charge, ou les ignorent. EffeTune fonctionne avec les valeurs réellement activées. |
| Le lecteur web mémorise-t-il la liste de lecture ? | Les réglages du mode répétition et du mode aléatoire sont enregistrés, mais les fichiers sélectionnés par la boîte de sélection standard ne sont généralement pas restaurés après un rechargement, en raison des restrictions du navigateur. |
| La lecture mobile continue-t-elle lorsque l'écran est éteint ? | Cela dépend du navigateur, et ce n'est pas garanti, en particulier sur iOS. EffeTune utilise Wake Lock dans les environnements compatibles, mais la lecture en arrière-plan n'est pas garantie. |
| Quelle est la différence entre les modes d’économie d’énergie d’EffeTune ? | Ils sont disponibles dans les versions Web/PWA et de bureau Electron. Ils se règlent dans **Configuration** → **Économie d’énergie**. **Priorité au traitement en arrière-plan** maintient le traitement de l’entrée externe pendant les silences. **Économie d’énergie équilibrée (par défaut)** conserve généralement l’entrée sélectionnée tout en réduisant le DSP et les mises à jour visuelles pendant les silences. **Économie d’énergie maximale** peut aussi arrêter une entrée inutilisée ou silencieuse en arrière-plan après le délai choisi. Lorsque le routage courant permet d’en confirmer la sûreté, la lecture peut continuer tandis que le DSP est contourné ou que la sortie reste à zéro. Aucun indicateur d’état distinct n’est affiché ; **Reprendre le traitement audio** ou **Réactiver l’entrée audio** n’apparaît dans le menu que lorsqu’une action de l’utilisateur est nécessaire. |
| Que modifient « Seuil de silence » et « Arrêter l’entrée audio après » ? | **Seuil de silence** (de -90 à -20 dBFS, par pas de 10 dB) fixe la puissance mesurée d’entrée et de sortie sous laquelle le son est considéré comme silencieux ; une valeur plus basse risque moins de prendre un son faible pour du silence. En **Économie d’énergie maximale**, **Arrêter l’entrée audio après** (1/5/15 minutes ou **Jamais**) ne commande que la libération du microphone ou de l’entrée. Ce délai est indépendant du délai plus court qui suspend un graphe sans routage : le graphe peut donc être Suspended alors que l’entrée reste conservée. |
| « Priorité au traitement en arrière-plan » garantit-elle le traitement quand la version Web/PWA est masquée ? | Non. EffeTune privilégie la continuité et évite sa propre suspension automatique due au silence d’une entrée externe, mais le navigateur et le système d’exploitation peuvent toujours geler, suspendre ou supprimer une page masquée. Si **Économie d’énergie maximale** a arrêté l’entrée, revenir à la page ou recevoir de nouveau un signal ne redemande pas silencieusement l’autorisation du microphone ; utilisez **Reprendre le traitement audio** par une action explicite. |
| Coût récepteur AV vs. interface ? | Réutiliser un récepteur AV avec HDMI est simple. Pour les configurations centrées sur PC, une interface multicanal plus de petits amplis offre un bon rapport coût/qualité. |
| Pas de son des autres applications juste après l'installation de VB-CABLE | La sortie par défaut du système d'exploitation a été basculée vers **CABLE Input**. Changez-la dans les paramètres sonores. |
| Seuls les canaux 3+4 changent de volume après la division | Placez un effet **Volume** après le diviseur et réglez **Channel** sur 3+4. Si placé avant, tous les canaux changent. |

---

## 5. Réponse en fréquence et correction acoustique

### 5.1. Importation des paramètres AutoEQ dans 15Band PEQ
À partir d'EffeTune v1.51 ou ultérieur, vous pouvez importer les paramètres d'égaliseur AutoEQ directement depuis le bouton en haut à droite.

### 5.2. Collage des paramètres de correction de mesure
Copiez les paramètres 5Band PEQ depuis la page de mesure et collez-les dans la vue **Effect Pipeline** en utilisant **Ctrl+V** ou le menu.

---

## 6. Conseils d'utilisation des effets
* Le flux du signal va de haut en bas.
* Utilisez l'effet **Matrix** pour les conversions comme 2→4ch ou 8→2ch (réglez **Channel = All** dans le routage de bus).
* Gérez le niveau, la sourdine et le délai pour jusqu'à 8 canaux avec **MultiChannel Panel**.

---

## 7. Liens de référence
* EffeTune Desktop : <https://github.com/Frieve-A/effetune/releases>
* Version web EffeTune : <https://effetune.frieve.com/effetune.html>
* Mesure de la réponse en fréquence : <https://effetune.frieve.com/features/measurement/measurement.html>
* VB-CABLE : <https://vb-audio.com/Cable/>
* Voicemeeter : <https://vb-audio.com/Voicemeeter/>
* ASIO Link Pro (version corrigée non officielle) : recherchez "ASIO Link Pro 2.4.1"
