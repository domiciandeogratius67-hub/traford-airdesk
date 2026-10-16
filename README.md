# Her Little Book

**A personal diary, dedicated to you with love from Traford.**

Her Little Book is a warm, pink, book-inspired diary for private pages, saved ideas, a calendar, gentle reminders, and a profile picture. Read your pages as an open book, use presentation mode to read together, or ask the optional local AI helper to think alongside you.

The interface is created by Traford and begins with the dedication: “This diary is dedicated to you, [her name], with love from Traford.” Your name fills in when the diary is set up.

## Open the hosted diary

Open the published diary:

**https://domiciandeogratius67-hub.github.io/traford-airdesk/**

GitHub Pages serves the static interface. The first visit asks for a name and password; later visits ask for that password before the book opens. Pages, ideas, profile picture, reminders, and chat are encrypted in this browser and stay on this device/browser. **The password cannot be reset.** Forgetting it means the encrypted diary cannot be recovered.

This is a personal, single-browser diary—not an account service. Your password does not authenticate a server, and cannot protect you if someone has access to your already-unlocked browser profile or the device itself. Lock the diary before leaving the device. The photo is stored in your encrypted browser data, resized on-device, and is not uploaded.

## Start chatting with local Ollama

1. Install [Ollama](https://ollama.com/download).
2. Pull and start the default model once:

   ```sh
   ollama run qwen3
   ```

   Keep Ollama running. You can use another installed model by changing the model name in AirDesk settings.
3. Install Python 3.9 or later. From a copy of this repository, start the companion:

   ```sh
   python companion/server.py
   ```

   On some systems the command is `python3 companion/server.py` or `py companion/server.py`. The service listens only on `127.0.0.1:8765`; it does not listen on your network.
4. Open the hosted diary and open the settings button; select **Check connection**. If your browser asks permission for the hosted page to communicate with a local device, allow it to use the companion. Chromium-based browsers may require this local-network permission.

You can also run the diary completely locally by opening `http://127.0.0.1:8765` after starting the companion.

## Diary features

- **Private book:** choose a name and password, then unlock the same encrypted local diary on return. AES-GCM encrypts the diary contents; PBKDF2 derives its key from the password.
- **Diary pages:** save a dated, titled entry with a mood. Read pages in a two-page book, page through your history, or switch to “Read together” presentation mode.
- **Ideas:** save and pin ideas separately from diary pages.
- **Calendar:** browse months and see diary pages and reminders on their dates.
- **Reminders:** set a date and optional time. In-page reminders work while the diary is open. Browser notifications are optional; they require permission and this page to remain open. There is no push service, so a closed browser cannot send reminders.
- **Profile:** save a display name and an optional profile photo in the encrypted diary.
- **Daily love notes:** one of 61 original notes from Traford appears on the facing page, changing each day.
- **Optional local AI:** keep Ollama on-device and ask the built-in helper for a little brainstorming.

Browser storage is local to this device and browser. It is not synced or backed up automatically. Clear browser site data and the diary is removed.

### Privacy and safety boundary

- Ollama stays on your device. The companion only calls Ollama at `127.0.0.1:11434`.
- The companion binds to loopback and allows the AirDesk GitHub Pages origin plus a short list of local development origins; it does not enable wildcard CORS.
- Its API is limited to checking Ollama, listing installed model names, and sending bounded chat messages. It has no shell execution, arbitrary URL proxy, or file-reading API.
- Chat and board data are saved in your browser's local storage. Clearing site data removes them. Do not use a shared browser profile for private conversations.
- The app uses system fonts and makes no third-party font or analytics requests.

## Run checks

The app has no JavaScript build step or package dependencies. To run the companion boundary tests:

```sh
python -m unittest discover -s tests -v
```

To serve and test the local app without installing extra packages:

```sh
python companion/server.py
```

Then open `http://127.0.0.1:8765`.

## GitHub Pages deployment

The included [Pages workflow](.github/workflows/pages.yml) deploys the static app on every push to `main` and the project preview branch, and supports manual runs. In the repository, open **Settings → Pages** and select **GitHub Actions** as the build and deployment source. The workflow uses GitHub's Pages artifact and deployment actions; it does not use Jekyll or a separate `gh-pages` branch. Check **Actions → Deploy AirDesk to GitHub Pages** for the deployment URL and status.

For a fork, update the Pages URL in `companion/server.py`'s `ALLOWED_ORIGINS` to the fork owner's `https://<owner>.github.io` origin before deploying, then push that change. A repository path does not change the origin.

## A note on the original inspiration

Her Little Book is an original addition to the AirDesk project, not a fork or code port. The original spatial cards and conversational interaction were broad product ideas that informed AirDesk. See [barehands](https://github.com/jaredrhod/barehands) for the independent project that sparked the original exploration.

## License

Copyright © 2026 Traford.

This project is licensed under the GNU Affero General Public License, version 3 or (at your option) any later version. See [`LICENSE`](LICENSE) and the [official license text](https://www.gnu.org/licenses/agpl-3.0.txt).
