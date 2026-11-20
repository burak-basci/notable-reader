# Notable Reader

Artikel, Textauswahl und lokale Dokumente vorlesen. Kostenlose Basis, keine
Registrierung, keine Werbung, keine Textkontingente. Die Web-App bietet kostenlose lokale Downloads. In der Erweiterung sind Downloads
Premium: 2,99 € monatlich oder eine einzelne Unterstützung ab 100 € für Lifetime.
Lesen bleibt kostenlos; ein Dokumentupload oder ein Pflichtkonto ist nicht nötig.

- **Web-App:** https://reader.benotable.de/app/
- **Website und Downloads:** https://reader.benotable.de/
- **Quellen:** https://github.com/burak-basci/notable-reader
- **Premium kaufen / Zahlungen verwalten:** https://reader-premium.benotable.de/account
- **Unterstützen:** https://buy.stripe.com/cNi7sM72dbaU3w6eY7aVa00

## Was Version 2.4.0 kann

- Ein kanonischer Quellstand für die bisherige Papier-/Grün-Oberfläche, den großen 88px-Startknopf und die vollständige Popup-/Fokussteuerung. Optional nutzt dieselbe Erweiterung den lokalen Nativecompanion mit installierten Stimmen/GPU; ohne ihn bleibt die Browserengine verfügbar.
- Browser-Erweiterung: Artikel und markierten Text über einen bewussten Klick
  öffnen; eine kompakte Leiste mit Satzmarkierung, Pause/Weiterlesen, Sprüngen,
  Stimmenauswahl, Lautstärke, Tempo von 0,5× bis 4× und Lesestellen.
- Dokument-App: PDF mit Textebene und Seitenvorschau; passwortgeschützte PDF nach
  Eingabe des Passworts; EPUB ohne DRM in Buchreihenfolge; DOCX-Absätze und
  Tabellenzellen; TXT, Markdown als Klartext und HTML ohne aktive Inhalte.
- Wortmarkierung in der Dokument-App, wenn die gewählte Systemstimme Wortgrenzen
  meldet; sonst bleibt die aktuelle Textpassage markiert.
- Verarbeitung der Dateien auf dem Gerät. Keine Dokumente an Notable Reader,
  kein Pflichtkonto für das Lesen, keine Werbung oder Analysetracker.
- Optionale lokale KI-Stimmen funktionieren auch ohne Systemstimmen: Deutsch
  mit Piper Thorsten high und Englisch mit Kokoro82M FP32/Bella. Der ausdrücklich
  angeklickte Modelldownload umfasst 113,9 MB beziehungsweise 326,1 MB, plus
  einmalig ca. 30 MB lokale Sprachmodule in der Web-App. Herkunft, Lizenzen und
  Löschknopf sind direkt an der Downloadauswahl sichtbar.
- System-/Browserstimmen. Standardmäßig werden nur Stimmen angeboten, die der
  Browser als lokal meldet. Online-Stimmen erfordern bewusstes Einschalten.
- Lokaler Hörbuch-Export: vollständige geöffnete Bücher und Texte als MP3 oder
  WAV speichern. Die Audioerzeugung und Kodierung laufen auf dem eigenen Gerät.
  Der kompakte Player lässt Import, Stimmen und erweiterte Optionen getrennt
  öffnen; GitHub und Hörbuchaktion sind direkt erreichbar.

## Bücher und Text als Hörbuch speichern

Die [Web-App](https://reader.benotable.de/app/?mode=audiobook) öffnen und eine
EPUB-, PDF-, DOCX-, TXT-, Markdown- oder HTML-Datei auswählen oder Text einfügen.
PDFs benötigen eine Textebene, EPUBs müssen DRM-frei sein. Unter **Hörbuch
erstellen** eine lokale KI-Stimme und MP3 oder WAV wählen. Ein noch nicht
installiertes Sprachmodell wird erst nach einem ausdrücklichen Klick geladen.
System- und Online-Stimmen des Browsers stehen für diesen Dateiexport nicht
zur Verfügung, weil die Browser-Sprachschnittstelle keine Audiodaten ausgibt.

Der Export verarbeitet den vollständigen geöffneten Text von Anfang bis Ende,
unabhängig von der Lesestelle. Er läuft mit Standardtempo 1×; Tempo und
Lautstärke des Vorleseplayers verändern die gespeicherte Datei nicht.
MP3 verwendet 64 kbit/s mono, WAV unkomprimiertes 16-Bit-PCM mono. Für WAV gilt
die technische 4-GiB-Dateigrenze; MP3 ist für lange Bücher platzsparender.
Auf der Website sind diese Exporte kostenlos. In der Erweiterung wird eine gültige,
auf dem Gerät geprüfte Premium-Lizenz benötigt. Es gibt kein Wortkontingent. Die vorhandenen
Sicherheitsgrenzen des Dateiimports gelten weiterhin.

Auf unterstützten Browsern lässt sich direkt in eine ausgewählte Datei
schreiben. Sonst speichert der Browser Audio abschnittsweise im lokalen
Dateisystem OPFS oder in IndexedDB und bietet anschließend den Download an.
Nur wenn beide Verfahren fehlen, gilt eine 32-MiB-Grenze für den
Arbeitsspeicher-Fallback. Die App meldet echte Speichergrenzen ausdrücklich.
Eine vollständige PCM-Kopie des Buchs wird nicht im RAM gesammelt.

Den Tab während der Berechnung geöffnet lassen; Dauer und verfügbare
Speichermenge hängen vom Gerät und vom Buch ab. Fortschritt und Abbruch sind
sichtbar. Unterbrochene Berechnungen beginnen erneut. Nach normalem Ende oder
Abbruch werden temporäre Audiodaten bereinigt; nach einem Browserabsturz können
Reste mit **Temporäre Hörbuchdaten löschen** entfernt werden. Aktive Exporte
anderer Tabs bleiben geschützt. Bewusst heruntergeladene Dateien verbleiben
im gewählten Downloadordner.

Anleitungen: [Buch in Hörbuch umwandeln](https://reader.benotable.de/buch-in-hoerbuch/)
und [Book to audiobook](https://reader.benotable.de/book-to-audiobook/).

Stimmen, Sprachumfang, Aussprache und die tatsächlich erreichbare
Wiedergabegeschwindigkeit hängen vom Betriebssystem und der gewählten Stimme ab.
Eine als online gemeldete Systemstimme kann Text an ihren Anbieter übertragen. Auf
Systemen ohne installierte Stimmen kann der bewusst gestartete lokale
KI-Modelldownload genutzt, eine Systemstimme eingerichtet oder eine verfügbare
Online-Stimme ausdrücklich eingeschaltet werden. Der Reader zeigt diesen
Fall an, statt eine funktionierende Sprachausgabe vorzutäuschen.

PDF-Scans brauchen eine vorgelagerte OCR. Alte binäre DOC-Dateien müssen zuerst
als DOCX exportiert werden. Verschlüsselte EPUBs/Office-Archive, ZIP64-Archive,
unsichere Pfade und Archive mit auffälligen Entpackgrößen werden abgewiesen.
Für den Archivimport gelten technische Sicherheitsgrenzen: höchstens 128 MB
Archiv-/Gesamtinhalt, 32 MB je Datei, 4.096 Einträge und bei großen Einträgen ein
maximales Kompressionsverhältnis von 1.000:1. Diese Grenzen verhindern
Speicherüberlastungen; sie sind kein kostenpflichtiges Textkontingent.

## Erweiterung installieren

Aus dem [GitHub-Release](https://github.com/burak-basci/notable-reader/releases)
das zur Installation passende Paket und SHA256SUMS herunterladen:

- `notable-reader-extension-2.4.0.zip`: offizielle Erweiterungs-ID
  `hgkfghgifkifgmklfgglilnmjglojonm`.
- `notable-reader-compatible-2.4.0.zip`: bestehende lokale Companion-ID
  `bbobdmpbadoijfffgfeefcenegbbjddd` für ein kompatibles Upgrade.

Beide Pakete haben dieselbe Version, Oberfläche und sämtliche Funktionen. Nur
der öffentliche Identitätsschlüssel im Manifest unterscheidet sich. Die private
1.6.4 und die bisherige öffentliche 2.3.3 waren verschiedene Quellen; 2.4.0 führt
ihren aktuellen Quellstand zusammen. Eine bloße höhere Versionsaufschrift ist
kein Upgrade. Der Store besitzt einen eigenen Freigabestand; ein GitHub-Release
ändert weder einen laufenden Review noch die Storeinstallation automatisch.

Hash prüfen, ZIP vollständig entpacken und auf `chrome://extensions` bzw.
`edge://extensions` im Entwicklermodus **Entpackte Erweiterung laden** wählen.
Der gewählte Ordner muss `manifest.json` enthalten. Bei bestehender Installation
denselben ID-Typ und denselben Installationsordner verwenden; vorher aktuelle
Einstellungen und Lesestellen sichern. Keine zweite Variante gleichzeitig als
vermeintliches Upgrade installieren. Die echte geladene Version/ID und sämtliche
Paketdateien nach dem Upgrade vergleichen. Details: [Installation](docs/install.md).

Die Browserengine verarbeitet lokale Dokumente und Artikel ohne Python-Daemon.
Lokale KI-Modelle werden nur nach einem ausdrücklichen Download angeboten.
Der optionale Nativeadapter benutzt ausschließlich den lokalen Anschluss
127.0.0.1; seine Berechtigung wird bei der bewussten Einrichtung angefragt.
Er benötigt separat installierte Linux-Voraussetzungen, lokale Modelle und den
lokalen Browseranschluss. Er startet keine automatische Wiedergabe. Native
Installation, Grenzen und Lizenzen: [native/README.md](native/README.md).

Für Premium greift die Erweiterung auf reader-premium.benotable.de zu.
Lizenzprüfung und zufällige Gerätekennung enthalten keine Dokumenttexte oder
Audiodaten. Aktivierungscodes und Lizenznachweise niemals veröffentlichen.
Die Web-App kann auf unterstützten Geräten als PWA installiert werden; sie
bleibt vom optionalen Nativecompanion unabhängig.

## Datenschutz

Dateien und geladener Text bleiben im Speicher der geöffneten Seite. Der
Hörbuchexport kann temporäres Audio lokal in OPFS oder IndexedDB speichern,
wie oben beschrieben. Es gibt keinen Upload-Endpunkt. Beim Schließen wird die
Textsitzung verworfen. Bis zu 100
Lesestellen werden als Text-Fingerabdruck und Abschnittsnummer gespeichert,
zusammen mit Stimme, Tempo, Lautstärke und Optionen. Es werden weder Dokumenttext
noch Dateiname oder Quell-URL in diesen Einstellungen gespeichert.

Die Dokument-App nutzt den Browserspeicher ihrer Website beziehungsweise ihrer
Erweiterungsseite. Die Artikelleiste speichert Einstellungen in
`chrome.storage.local`. **Einstellungen & Lesestellen löschen** entfernt diese
Daten im jeweiligen Reader. Die Web-App speichert öffentlich ausgelieferte
Programmdateien im Offline-Cache; Dokumentdateien gehören nicht zu diesem Cache.
Freiwillig heruntergeladene KI-Modelle liegen getrennt im CacheStorage
`notable-reader-neural-models-v1` und werden mit **Lokale KI-Modelle löschen**
entfernt. Beim Modelldownload erhält Hugging Face technische Verbindungsdaten;
Dateien und Text werden nicht übertragen. Modellgröße und SHA-256 müssen vor
der Speicherung mit dem gepinnten Katalog übereinstimmen. Die Inferenz arbeitet
im eigenen Worker mit ONNX Runtime WebAssembly und gibt lokal erzeugtes Audio
über einen Audiopuffer aus. Ein Abschnitt wird vorausberechnet; tatsächliche
Synthesegeschwindigkeit und Geräteleistung können das gewünschte Tempo begrenzen.
Websitebesuch und freiwillige Zahlung unterliegen den Hinweisen auf
https://reader.benotable.de/privacy und den Bedingungen des Zahlungsanbieters.

## Entwicklung und Prüfung

Die Erweiterung ist buildless HTML, CSS und JavaScript. Produktcode liegt unter
`extension/`. Kein CDN und kein nachgeladener ausführbarer Fremdcode.

```sh
npm install
npm run test:core
npm run test:browser
python3 tools/release.py --freeze-inventory
python3 tools/release.py --output-dir /path/to/new-release-directory
```

Die Browserprüfung benötigt eine von Playwright unterstützte Chromium-Installation;
`npx playwright-core install chromium` lädt sie bei Bedarf. Tests starten ausschließlich
einen eigenen stummen Headless-Browser und benutzen öffentliche synthetische
Dokumente unter `tests/fixtures/`. Die Stimmen-Zustandsprüfung benutzt kontrollierte
Teststimmen; der tatsächliche Stimmenbestand wird separat erfasst. Ein bestandener
Stummschalttest ist kein subjektives Klangurteil.

Der vollständige Hörbuchexport hat eine gesonderte reproduzierbare Abnahme:
[tests/audiobook-export/README.md](tests/audiobook-export/README.md). Sie trennt
echte vollständige ONNX-Buchsynthese und vollständige Dateidekodierung von
deterministischen Tests für 100.000 Wörter, Speichergrenzen und Abbruch.
`node tests/audiobook-ui.mjs` prüft nach dem Releasebau zusätzlich den tatsächlichen
UI-Weg mit lokal vorhandenen, hashgeprüften Piper-Modellen, Offline-Reload,
MP3/WAV-Download und Abbruch. Dafür gelten die Modellpfade und Voraussetzungen
der gesonderten Abnahme.

Die PDF-Testdateien lassen sich mit dem optionalen Entwicklungswerkzeug
PyMuPDF neu erzeugen: `python3 tools/fixtures.py tests/fixtures`.
PyMuPDF gehört nicht zur Browserlaufzeit. Der optionale Nativecompanion verwendet es als separat installierte AGPL- bzw. kommerziell lizenzierte Abhängigkeit.

## Lizenzen

Die Browserdistribution einschließlich eSpeak NG wird unter
GPL-3.0-or-later ausgeliefert (LICENSE/COPYING). Der selbst geschriebene
Browserreadercode ist zusätzlich unter MIT verfügbar (LICENSE-MIT, Dateiheader).
Mozilla PDF.js und Readability: Apache-2.0. fflate und ONNX Runtime: MIT.
Piper-Phonemizer-Wrapper: MIT, eingebettetes eSpeak NG: GPL-3.0-or-later.
Kokoro-Modell: Apache-2.0. Piper-Modellverzeichnis: MIT, Thorsten-Sprachdatensatz:
CC0. Stimmengewichte kommen erst nach dem ausdrücklichen Download.
Der lokal gebündelte MP3-Encoder @breezystack/lamejs 1.2.7 steht unter
LGPL-3.0; seine vollständigen korrespondierenden Quellen und Hinweise liegen
unter `extension/vendor/export/` und sind Bestandteil der Distribution.

Vollständige Phonemizer-/eSpeak-Quellen, Sprachdatenquellen, Originalhinweise,
Buildanleitung und Hashinventar sind im Quellpaket enthalten, siehe
[third_party_sources/README.md](third_party_sources/README.md) und
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Die Erweiterungs-ZIPs enthalten keine Modellgewichte, Pythonumgebung oder CUDA-Bibliotheken. Das kanonische Sourcepaket enthält zusätzlich die streng allowlisteten optionalen Nativequellen samt Linux-Bootstrap unter AGPL-3.0-or-later, vollständigem Lizenztext und [eigenen Drittanbieterhinweisen](native/THIRD_PARTY_NOTICES.md). Die Browserlizenzen und unveränderten Vendorquellen bleiben erhalten. Kein MIT-/GPL-only-Versprechen für die Nativeausführung.

Der reproduzierbare unveränderliche Releasebau, Source-/Commitbindung, beide ID-Pakete und die daemonfreie Web-Ausgabe sind in [docs/releases.md](docs/releases.md) beschrieben.

## Korrektur in 2.3.2

Abgebrochene oder überholte PDF-Abbildungsberechnungen erzeugen keine bleibenden Fehlerhinweise. Ein erfolgreicher neuer Bildaufbau stellt die ursprüngliche Beschriftung wieder her; echte aktuelle Fehler bleiben sichtbar. Die getrennten Prüfungen `test:figure-paint` und `test:figure-paint-browser` decken Abbruch, Wiederholung und rasche Darstellungswechsel ab.

## Ruhige Darstellung und Dokumentdownloads

Die gemeinsame Papier-/Grün-Steuerung bleibt in Artikel, Datei-App, Fokusansicht und Erweiterungsmenü an denselben Stellen. Die Dokumentpalette ist von der Playerfarbe getrennt; Sprache, Region,12-/24-Stundenformat, Kapitel, Restdauer und die Prognose nach dem Fortsetzen sind einstellbar.

HTML- und EPUB-Dateien übernehmen lokal enthaltene PNG-/JPEG-/WebP-Abbildungen in die bereinigte Textfassung. Externe Bildadressen werden nicht nachgeladen. Bei Artikeln können nur bereits geladene Bilder übernommen werden, deren Pixel der Browser freigibt; ausgelassene Bilder werden deutlich gemeldet. PDFs behalten eine gesonderte Originalvorschau und liefern verfügbare Rasterabbildungen für die Lesefassung. Komplexe, nicht trennbare Grafik kann als ausdrücklich beschriftete Seitenabbildung erscheinen. Wiederkehrende Randzeilen werden konservativ bereinigt; echte Kapitel und vorhandene Lesestellen werden zugeordnet.

Der gleiche Downloadknopf bietet HTML und eine gerasterte PDF-Fassung mit gewählter Darstellung. Diese bereinigte PDF ist keine originalgetreue Ausgabe mit durchsuchbarer Textebene. Ein Abbruch oder Fehler stellt kein unvollständiges Ergebnis bereit. Browser-Dateiwerkzeuge zeigen18 tatsächlich unterstützte Darstellungsfelder; die zusätzliche native Originalseitensteuerung unterstützt20. Nicht unterstützte Optionen werden nicht als wirkungslose Checkboxen angeboten.

## Sichtbare Spendenwege in 2.3.3

Homepage, Web-App, Erweiterungs-Popup und Einstellungen bieten einen direkten Stripe-Spendenlink mit frei wählbarem Betrag. Eine einzelne Spende ab 100 € einschließlich genau 100 € gibt Premium auf Lebenszeit; kleinere Spenden werden nicht addiert. Lesen bleibt kostenlos, Webdownloads bleiben kostenlos. Die monatliche Premiumoption für Erweiterungsdownloads kostet weiterhin 2,99 €. Die gemeinsam gestaltete Playerleiste bleibt erhalten. Der Chrome-Web-Store-Vertrieb hat einen gesonderten Reviewstand; dieser Quellrelease nimmt keine Storeeinreichung vor.
