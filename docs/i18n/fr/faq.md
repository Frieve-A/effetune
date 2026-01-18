---
title: "FAQ & Troubleshooting - EffeTune"
description: "Frequently asked questions and troubleshooting guide for Frieve EffeTune audio processor."
lang: en
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
Téléchargez le pack de pilotes VB-CABLE, exécutez `VBCABLE_Setup_x64.exe` en tant qu'administrateur et redémarrez. Rétablissez la sortie par défaut du système d'exploitation vers vos haut-parleurs/DAC et définissez les formats **CABLE Input** et **CABLE Output** sur 24 bits, 96 000 Hz. Lancez `VBCABLE_ControlPanel.exe` en tant qu'administrateur, choisissez **Menu▸Internal Sample Rate = 96000 Hz**, puis cliquez sur **Restart Audio Engine**.

### 1.2. Routage du service de streaming (exemple Spotify)
Ouvrez **Settings▸System▸Sound▸Volume mixer**, et définissez la sortie de `Spotify.exe` sur **CABLE Input**. Lisez une piste pour confirmer l'absence de son provenant des haut-parleurs.
Sous macOS, utilisez **SoundSource** de Rogue Amoeba pour affecter la sortie de Spotify à **CABLE Input** de la même façon.

### 1.3. Paramètres audio d'EffeTune
Lancez l'application de bureau et ouvrez **Config Audio**.
- **Input Device:** CABLE Output (VB-Audio Virtual Cable)
- **Output Device:** DAC/Haut-parleurs physiques
- **Sample Rate:** 96 000 Hz (des taux inférieurs peuvent dégrader la qualité)

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
| Pas de sortie audio | Pour l'application web, vérifiez que les sorties du système d'exploitation et du navigateur pointent vers votre DAC/AMP. Pour l'application de bureau, vérifiez le périphérique de sortie dans **Config Audio**. |
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
| Entrée surround (5.1ch, etc.) ? | L'API Web Audio limite l'entrée à 2 canaux. La sortie et les effets prennent en charge jusqu'à 8 canaux. |
| Longueur recommandée de la chaîne d'effets ? | Utilisez autant d'effets que votre CPU permet sans causer de coupures ou de latence élevée. |
| Comment obtenir la meilleure qualité sonore ? | Utilisez 96 kHz ou plus, commencez avec des réglages subtils, surveillez la marge avec **Level Meter**, et ajoutez **Brickwall Limiter** si nécessaire. |
| Fonctionne-t-il avec n'importe quelle source ? | Oui. Avec un périphérique audio virtuel, vous pouvez traiter le streaming, les fichiers locaux ou l'équipement physique. |
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
* Version web EffeTune : <https://effetune.frieve.com/features/measurement/measurement.html>
* VB-CABLE : <https://vb-audio.com/Cable/>
* Voicemeeter : <https://vb-audio.com/Voicemeeter/>
* ASIO Link Pro (version corrigée non officielle) : recherchez "ASIO Link Pro 2.4.1"
