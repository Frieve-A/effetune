---
title: "FAQ et dépannage - EffeTune"
description: "Questions fréquentes et guide de dépannage pour le processeur audio Frieve EffeTune."
lang: fr
---

# FAQ EffeTune

EffeTune est une application DSP en temps réel pour les passionnés d'audio disponible en version web et en application de bureau. Ce document couvre la configuration, le dépannage, l'utilisation multicanal, le fonctionnement des effets et la correction de fréquence.

Pour traiter le son d’un onglet Chrome ou Edge, consultez le [guide de l’extension de navigateur](browser-extension.md).

## Contenu
1. Configuration initiale pour le streaming
   1. Installation de VB-CABLE et correction facultative du repliement à 96 kHz
   2. Routage du service de streaming (exemple Spotify)
   3. Paramètres audio d'EffeTune
   4. Vérification du fonctionnement
2. Dépannage
   1. Qualité de lecture audio
   2. Utilisation du CPU
   3. Écho
   4. Problèmes d'entrée, de sortie ou d'effets
   5. Discordance de sortie multicanal
   6. Dépannage de l’affichage
3. Connexions multicanal et matérielles
   1. HDMI + récepteur AV
   2. Interfaces sans pilotes multicanaux
   3. Retard de canal et alignement temporel
   4. Limite de 16 canaux et expansion
4. Questions fréquemment posées
5. Réponse en fréquence et correction acoustique
6. Conseils d'utilisation des effets
7. Liens de référence

---

## 1. Configuration initiale pour le streaming

Exemple Windows : Spotify → VB-CABLE → EffeTune → DAC/AMP. Les concepts sont similaires pour d'autres services et systèmes d'exploitation.

### 1.1. Installation de VB-CABLE et correction facultative du repliement à 96 kHz
Téléchargez le pack de pilotes VB-CABLE, exécutez `VBCABLE_Setup_x64.exe` en tant qu'administrateur, puis redémarrez le PC. L’installation peut basculer la sortie par défaut du système sur **CABLE Input** ; dans ce cas, resélectionnez vos haut-parleurs ou votre DAC.

Si VB-CABLE produit un bruit de repliement au-dessus de 20 kHz, son fonctionnement interne à 48 kHz en est la cause. Pour ce problème uniquement, réglez **CABLE Input** et **CABLE Output** sur 24 bits, 96 000 Hz. Ouvrez ensuite `VBCABLE_ControlPanel.exe` en tant qu'administrateur, choisissez **Menu▸Internal Sample Rate = 96000 Hz**, puis cliquez sur **Restart Audio Engine**. Les droits d’administrateur sont nécessaires pour que ce réglage soit conservé après le redémarrage. Ce réglage modifie VB-CABLE lui-même et n'est pas nécessaire pour utiliser normalement EffeTune à 96 kHz.

### 1.2. Routage du service de streaming (exemple Spotify)
Ouvrez **Paramètres▸Système▸Son▸Mélangeur de volume**, et définissez la sortie de `Spotify.exe` sur **CABLE Input**. Lisez une piste pour confirmer l'absence de son provenant des haut-parleurs.
Sous macOS, utilisez **SoundSource** de Rogue Amoeba pour affecter la sortie de Spotify à **CABLE Input** de la même façon.

### 1.3. Paramètres audio d'EffeTune
Ouvrez EffeTune et choisissez **Configuration audio** dans le menu **Paramètres**.
- **Périphérique d'entrée :** CABLE Output (VB-Audio Virtual Cable)
- **Périphérique de sortie :** DAC/Haut-parleurs physiques
- **Fréquence d'échantillonnage :** sélectionnez 96 kHz. Ce réglage définit la fréquence de traitement interne d'EffeTune afin de réduire le repliement audible dans les effets non linéaires ; il est indépendant de la fréquence d'échantillonnage du système, du DAC ou de VB-CABLE. Vérifiez la fréquence d'échantillonnage effective affichée dans l'application ; en cas de coupures, allégez les effets exigeants ou baissez la fréquence d'échantillonnage.

### 1.4. Vérification du fonctionnement
Avec Spotify en lecture, basculez le bouton principal **ON/OFF** dans EffeTune et confirmez que le son change.

---

## 2. Dépannage

### 2.1. Problèmes de qualité de lecture audio

| Symptôme | Solution |
| ------ | ------ |
| Coupures ou accrocs | Choisissez **Réinitialiser l'audio** dans le menu **Paramètres** ou dans le menu supplémentaire sur mobile. Dans l'application de bureau, vous pouvez aussi choisir **Recharger** dans le menu **Affichage**. Réduisez le nombre d'effets actifs si nécessaire. |
| Distorsion ou écrêtage | Insérez **Level Meter** à la fin de la chaîne et maintenez les niveaux en dessous de 0 dBFS. Ajoutez **Brickwall Limiter** avant Level Meter si nécessaire. |
| Bruit de repliement au-dessus de 20 kHz avec VB-CABLE | Sa fréquence interne est peut-être encore de 48 kHz. Appliquez le réglage facultatif à 96 kHz de la section 1.1. |

### 2.2. Utilisation élevée du CPU
Désactivez les effets que vous n'utilisez pas ou retirez-les de l'**Effect Pipeline**.

### 2.3. Écho
Vos périphériques d'entrée et de sortie peuvent être en bouclage. Assurez-vous que la sortie d'EffeTune ne revient pas à son entrée.

### 2.4. Problèmes d'entrée, de sortie ou d'effets

| Symptôme | Solution |
| ------ | ------ |
| Pas d'entrée audio | Assurez-vous que le lecteur envoie sa sortie vers **CABLE Input**. Autorisez l'accès au microphone dans le navigateur et sélectionnez **CABLE Output** dans **Configuration audio**. |
| L'effet ne fonctionne pas | Confirmez que le maître, chaque effet et toute **Section** sont sur **ON**. Réinitialisez les paramètres si nécessaire. |
| Pas de sortie audio | Vérifiez **Configuration audio**. Si votre navigateur ne permet pas de sélectionner un périphérique de sortie, vérifiez que les sorties par défaut du système d'exploitation et du navigateur pointent vers votre DAC/AMP. |
| D'autres lecteurs signalent "CABLE Input en cours d'utilisation" | Assurez-vous qu'aucune autre application n'utilise **CABLE Input**. |

Les effets qui nécessitent WebAssembly affichent un message en haut de leur panneau lorsqu’ils ne peuvent pas fonctionner. Activez **Utiliser le traitement audio WebAssembly** dans **Configuration audio**. Si cette option est déjà activée, choisissez **Réinitialiser l'audio** ou rechargez EffeTune. Le message disparaît dès que l’effet fonctionne à nouveau.

### 2.5. Discordance de sortie multicanal
EffeTune produit les canaux dans l'ordre numérique, jusqu'à 16 canaux. Faites correspondre **Canaux de sortie :** à la configuration du périphérique. Pour une installation 7.1ch, réglez le périphérique et EffeTune sur 8ch et utilisez les libellés de canaux du périphérique pour router les canaux arrière. Pour une installation à 16 canaux, sélectionnez 16 canaux aux deux endroits et vérifiez le mappage des canaux du périphérique.

### 2.6. Dépannage de l’affichage {#display-troubleshooting}

Dans l’application de bureau, **Utiliser l’accélération matérielle** est activé par défaut. Si la fenêtre clignote ou cesse de se mettre à jour, désactivez cette option dans **Paramètres > Configuration...**, puis redémarrez EffeTune. Si les problèmes d’affichage se répètent, EffeTune la désactive et redémarre automatiquement. Pour réessayer, réactivez l’option et redémarrez l’application.

---

## 3. Connexions multicanal et matérielles

### 3.1. HDMI + récepteur AV
Configurez la sortie HDMI du PC selon la disposition des haut-parleurs du récepteur et connectez-la à un récepteur AV. EffeTune peut envoyer jusqu'à 16 canaux par un seul câble lorsque le PC, le récepteur et la liaison HDMI les prennent en charge. Les récepteurs plus anciens peuvent dégrader la qualité sonore ou remapper les canaux de manière inattendue.

### 3.2. Interfaces sans pilotes multicanaux (ex. MOTU M4)
Out 1‑2 et Out 3‑4 apparaissent comme des périphériques séparés, empêchant la sortie sur 4 canaux. Solutions de contournement :
- Utilisez **Voicemeeter** pour fusionner les canaux via ASIO.
- Utilisez **ASIO Link Pro** pour exposer un périphérique virtuel à 4 canaux (avancé).

### 3.3. Retard de canal et alignement temporel
Utilisez **MultiChannel Panel** ou **Time Alignment** pour retarder les canaux par pas de 10 µs (minimum 1 échantillon). Pour aligner les enceintes avant sur des enceintes arrière Bluetooth ou sans fil dont la latence mesurée est bien plus élevée, retardez les canaux avant de 100-400 ms ; ce n’est pas une valeur habituelle de correction de distance. La synchronisation vidéo doit être ajustée côté lecteur.

### 3.4. Limite de 16 canaux et expansion
EffeTune prend actuellement en charge jusqu’à 16 canaux de sortie.

---

## 4. Questions fréquemment posées

| Question | Réponse |
| ------ | ------ |
| Sur quels appareils la version PWA fonctionne-t-elle ? | Elle peut être utilisée sur les principaux environnements mobiles et de bureau : smartphones et tablettes Android, iPhone/iPad, Windows, macOS, Linux et ChromeOS. Comme il s'agit d'une PWA, elle s'exécute dans le navigateur plutôt que comme une application native propre à chaque appareil. En revanche, la méthode d'installation, la sélection des périphériques audio d'entrée/sortie et les formats musicaux pris en charge dépendent du navigateur et du système d'exploitation. |
| Je n'arrive pas à installer la version PWA | Utilisez le bouton **Installer la version PWA** du site EffeTune, ou ouvrez le menu en forme d'engrenage en haut à droite de l'application web et choisissez **Installer l'application**. Si l'option d'installation n'apparaît pas, ouvrez le site dans Chrome ou Edge sur Android ou sur ordinateur. Sur iPhone/iPad, ouvrez le site dans Safari, puis ajoutez-le à l'écran d'accueil depuis le menu de partage. Les navigateurs intégrés aux applications, la navigation privée et les anciens navigateurs peuvent ne pas afficher l'option d'installation. |
| Entrée surround (5.1ch, etc.) ? | L'API Web Audio limite l'entrée à 2 canaux. La sortie et les effets prennent en charge jusqu'à 16 canaux. |
| Longueur recommandée de la chaîne d'effets ? | Utilisez autant d'effets que votre CPU permet sans causer de coupures ou de latence élevée. |
| Comment obtenir la meilleure qualité sonore ? | Réglez la **Fréquence d'échantillonnage** d'EffeTune sur 96 kHz, commencez par des effets subtils et surveillez la marge avec **Level Meter**. En cas de coupures, réduisez d'abord les effets exigeants ou le nombre d'effets actifs, puis baissez la fréquence si nécessaire. Ajoutez **Brickwall Limiter** si besoin. |
| Fonctionne-t-il avec n'importe quelle source ? | Oui. Avec un périphérique audio virtuel, vous pouvez traiter le streaming, les fichiers locaux ou l'équipement physique. |
| EffeTune peut-il lire des contenus protégés par DRM ? | Pas directement. EffeTune traite le son, tandis qu'un contenu protégé est conçu pour être lu uniquement dans les environnements autorisés par son fournisseur et peut ne pas être accessible aux applications tierces de traitement audio. Utilisez l'application ou le site officiel du fournisseur en respectant ses conditions et les modes de sortie audio pris en charge. EffeTune ne supprime ni ne contourne la protection du contenu. |
| Puis-je utiliser uniquement le lecteur de fichiers musicaux sans entrée audio ? | Oui. Si le son du microphone revient dans vos écouteurs ou votre casque après le démarrage, ouvrez **Configuration audio**, puis, dans **Périphérique d'entrée :**, sélectionnez **Aucun (lecteur de fichiers musicaux uniquement)**. EffeTune maintient alors la chaîne d'effets avec une source silencieuse, afin que le lecteur et les effets générateurs de signal comme **Oscillator** continuent de fonctionner. Si vous sélectionnez une entrée audio, vous pouvez traiter le son d'un appareil externe connecté via une interface audio USB ou surveiller l'entrée avec **Spectrum Analyzer**. |
| L'application web mobile peut-elle traiter le son d'autres applications ? | En général, non. Les navigateurs mobiles ne fournissent pas d'entrée de bouclage générique pour l'audio des autres applications. Sur mobile, EffeTune s'utilise donc surtout avec son lecteur intégré. |
| Quels formats de fichiers musicaux sont pris en charge ? | Cela dépend des capacités de décodage audio du navigateur et du système d'exploitation. En pratique, MP3, WAV et AAC/M4A sont largement pris en charge ; FLAC, OGG/Vorbis et Opus/WebM varient davantage selon l'environnement. L'application de bureau pour macOS convertit automatiquement les fichiers Apple Lossless (ALAC) au format M4A/MP4 pour les lire. EffeTune peut aussi lire le son des fichiers vidéo MP4, M4V, MOV, MKV, WebM et 3GP, et l'élément **Video** de Visualizer peut en afficher l'image ; la compatibilité dépend du codec audio interne, AAC étant le choix compatible le plus courant. Si un fichier ne se lit pas, essayez MP3, AAC/M4A ou WAV. |
| Puis-je lire plusieurs fichiers musicaux ? | Oui. Utilisez **Ouvrir des fichiers musicaux**, puis sélectionnez plusieurs fichiers dans la boîte de sélection standard de votre appareil avant de les ouvrir ; ils seront chargés comme liste de lecture. La sélection multiple ou la sélection de tous les fichiers d'un dossier dépend de l'appareil, du navigateur et du sélecteur de fichiers. |
| À quoi sert la Bibliothèque musicale ? | La Bibliothèque musicale indexe les dossiers musicaux sélectionnés afin de parcourir et rechercher par morceau, album, artiste, genre ou sous-dossier parent direct, puis de lire les résultats dans EffeTune. Les métadonnées de bibliothèque et les listes de lecture sont enregistrées dans l'application, pas dans les fichiers audio. |
| Où la Bibliothèque musicale est-elle disponible ? | L'application de bureau dispose de l'analyse complète des dossiers. Les navigateurs Chromium utilisent File System Access lorsque c'est disponible. Safari et Firefox utilisent une importation de secours ; il peut donc être nécessaire de resélectionner les dossiers ou fichiers après un rechargement ou une perte d'autorisation. |
| Comment actualiser ou reconnecter les dossiers de la Bibliothèque musicale ? | Utilisez **Analyser à nouveau la bibliothèque musicale** après avoir ajouté, supprimé ou modifié des fichiers. Si un dossier indique que l'accès manque, utilisez son bouton **Reconnecter** et autorisez de nouveau l'accès au même dossier. |
| Quels formats de listes de lecture la Bibliothèque musicale peut-elle importer ou exporter ? | La Bibliothèque musicale peut importer des listes M3U, M3U8, PLS et XSPF, et exporter des listes M3U8 ou XSPF. |
| La Bibliothèque musicale modifie-t-elle mes fichiers audio ? | Non. L'analyse, la lecture des métadonnées, le cache des pochettes, la modification des listes de lecture et la lecture restent dans l'application et ne modifient jamais les fichiers audio sur le disque. |
| Pourquoi la sélection du périphérique de sortie n'est-elle pas disponible dans l'application web ? | La prise en charge et les autorisations varient selon le navigateur. Essayez depuis une page sécurisée dans Chrome/Chromium, ou définissez le DAC/AMP souhaité comme sortie par défaut dans le système d'exploitation ou dans le navigateur. |
| Pourquoi la fréquence d'échantillonnage ou le nombre de canaux de sortie est-il revenu à une autre valeur ? | L'écran de réglages affiche 96 kHz comme fréquence d'échantillonnage par défaut, mais tant que vous n'avez pas enregistré de réglage, l'application peut démarrer avec la valeur par défaut du système ou du navigateur. Dans la version web, si le navigateur ou le périphérique refuse 96 kHz ou une autre valeur non prise en charge, EffeTune utilise une fréquence disponible. Vérifiez la fréquence d'échantillonnage effective affichée dans l'application. La prise en charge des canaux de sortie dépend aussi du navigateur et du périphérique. |
| Pourquoi l’indicateur de fréquence d’échantillonnage et de canaux est-il devenu rouge ? | EffeTune a détecté que le traitement des effets activés ne s’est pas terminé à temps pour le temps réel. L’avertissement rouge disparaît environ 10 secondes après le retour à la normale du traitement. Réduisez le nombre d’effets activés. |
| Le lecteur web mémorise-t-il la liste de lecture ? | Les réglages de répétition et de lecture aléatoire sont enregistrés, mais les fichiers musicaux sélectionnés ne sont pas restaurés après un rechargement, car les navigateurs ne conservent pas les sélections de fichiers ordinaires. |
| La lecture mobile continue-t-elle lorsque l'écran est éteint ? | Pas de manière fiable sur tous les navigateurs, en particulier sur iOS. EffeTune utilise Wake Lock lorsque c'est possible, mais la lecture en arrière-plan dépend du navigateur. |
| Quelle est la différence entre les modes d’économie d’énergie d’EffeTune ? | Ouvrez **Configuration > Économie d’énergie** (versions Web/PWA et application de bureau). **Priorité au traitement en arrière-plan** maintient le traitement de l’entrée externe pendant les silences. **Économie d’énergie équilibrée (par défaut)** réduit le DSP et les mises à jour visuelles pendant les silences tout en gardant l’entrée audio sélectionnée connectée. **Économie d’énergie maximale** libère en plus l’entrée audio lorsqu’elle reste silencieuse en arrière-plan ou inutilisée en mode Player pendant le délai configuré. L’entrée ne redémarre pas au retour d’un signal ; ouvrez l’application et choisissez **Reprendre le traitement audio** (ou **Réactiver l’entrée audio**) dans le menu. |
| Que fait « Ignorer le DSP d’affichage lorsque l’application est masquée » ? | Cette option est activée par défaut. Lorsque les graphiques des analyseurs ne sont pas visibles (par exemple pendant la navigation dans la Bibliothèque musicale, avec le mini-lecteur, pendant un test en double aveugle ou lorsque la fenêtre est réduite), EffeTune contourne les effets Analyzer pour économiser le CPU sans modifier le son. Désactivez-la si l’historique des analyseurs doit continuer à se mettre à jour en arrière-plan. |
| Que fait « Synchroniser les affichages avec l’audio » ? | Cette option aligne les graphiques et les indicateurs sur le son que vous entendez. Elle est désactivée par défaut, car elle peut ajouter de la latence audio (indisponible dans l’extension de navigateur). Avec un périphérique Bluetooth ou similaire, les affichages peuvent rester légèrement désynchronisés. |
| Que modifient « Seuil de silence » et « Arrêter l’entrée audio après » ? | **Seuil de silence** (de -90 à -20 dBFS, par pas de 10 dB) fixe le niveau sous lequel le son est considéré comme silencieux ; une valeur plus basse a moins de chances de traiter les passages calmes comme du silence. En **Économie d’énergie maximale**, **Arrêter l’entrée audio après** (1/5/15 minutes ou **Jamais**) fixe la durée pendant laquelle l’entrée doit rester silencieuse en arrière-plan ou inutilisée en mode Player avant qu’EffeTune la libère. |
| « Priorité au traitement en arrière-plan » garantit-elle le traitement quand la version Web/PWA est masquée ? | Non. Elle empêche EffeTune de suspendre le traitement de l’entrée externe pendant les silences, mais le navigateur ou le système d’exploitation peut toujours limiter ou suspendre les onglets en arrière-plan. |
| Coût récepteur AV vs. interface ? | Réutiliser un récepteur AV avec HDMI est simple. Pour les configurations centrées sur PC, une interface multicanal plus de petits amplis offre un bon rapport coût/qualité. |
| Pas de son des autres applications juste après l'installation de VB-CABLE | La sortie par défaut du système d'exploitation a été basculée vers **CABLE Input**. Changez-la dans les paramètres sonores. |
| Seuls les canaux 3+4 changent de volume après la division | Placez un effet **Volume** après le diviseur et réglez **Channel** sur 3+4. Si placé avant, tous les canaux changent. |
| Pourquoi une IR Reverb partagée sonne-t-elle sèche ou indique-t-elle une IR manquante ? | Les URL et les préréglages ne stockent que l'identifiant de contenu de l'IR, pas le fichier audio. Importez le fichier d'origine exact pour le relier automatiquement, ou choisissez un substitut dans **Bibliothèque de réponses impulsionnelles**. Vérifiez également **Dry** et **Dry Level** : sans IR, aucun signal wet n'est produit. |
| Comment une autre personne peut-elle reproduire mon résultat IR Reverb ? | Partagez le préréglage ou l'URL avec le fichier IR original et ses informations de source/licence. Le destinataire doit importer le fichier inchangé ; des octets identiques produisent le même identifiant. Alignez également la fréquence d'échantillonnage, la sélection des canaux de sortie et les réglages IR Reverb. |

---

## 5. Réponse en fréquence et correction acoustique

### 5.1. Importation des paramètres AutoEQ dans 15Band PEQ
Vous pouvez importer les paramètres d'égaliseur AutoEQ directement depuis le bouton en haut à droite.

### 5.2. Collage des paramètres de correction de mesure
Copiez les paramètres 5Band PEQ depuis la page de mesure et collez-les dans la vue **Effect Pipeline** en utilisant **Ctrl+V** ou le menu.

### 5.3. Utiliser une mesure multicanal avec Room EQ
Sur la page de mesure, sélectionnez les canaux individuels à mesurer sous **Canal de sortie** pour les mesurer au cours d'une seule session. Après l'enregistrement, Room EQ affiche une entrée distincte par canal, par exemple `Nom de la mesure [Ch 1]`, dans les listes **Measurement Ch 1**, **Measurement Ch 2** et les autres listes propres aux canaux. Dans chaque liste **Measurement Ch**, sélectionnez l'entrée correspondant à ce canal de sortie. Room EQ n'assigne pas les canaux automatiquement.

Utilisez **Copier les réglages PEQ par canal** pour coller dans **Effect Pipeline** une correction statique de la réponse en fréquence. Utilisez Room EQ pour une correction acoustique par canal fondée sur la réponse impulsionnelle.

---

## 6. Conseils d'utilisation des effets
* Le flux du signal va de haut en bas.
* Utilisez l'effet **Matrix** pour les conversions comme 2→4ch ou 16→2ch (réglez **Channel = All** dans le routage de bus).
* Gérez le niveau, la sourdine et le délai pour jusqu'à 16 canaux avec **MultiChannel Panel**.
* Pour un envoi/retour de réverbération multicanal, utilisez **Matrix** pour copier les canaux sources souhaités vers un bus libre, placez **IR Reverb** sur ce bus avec **Dry** désactivé et **Wet Level** à 0 dB, puis utilisez les gains de Matrix comme niveaux d’envoi. Ne renvoyez le bus wet que vers les canaux de sortie voulus, afin de ne pas dupliquer le trajet dry d’origine.

---

## 7. Liens de référence
* EffeTune Desktop : <https://github.com/Frieve-A/effetune/releases>
* Version web EffeTune : <https://effetune.frieve.com/effetune.html>
* Mesure de la réponse en fréquence : <https://effetune.frieve.com/features/measurement/measurement.html>
* VB-CABLE : <https://vb-audio.com/Cable/>
* Voicemeeter : <https://vb-audio.com/Voicemeeter/>
* ASIO Link Pro (version corrigée non officielle) : recherchez "ASIO Link Pro 2.4.1"

[← Retour au README](README.md)
