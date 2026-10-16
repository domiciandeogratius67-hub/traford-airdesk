# Traford AirDesk

**A calm, local-first AI desk for ideas, plans, and conversations. Created by Traford.**

AirDesk brings a flexible idea board and a private AI chat together in one friendly workspace. Pin a thought, capture something before it drifts away, switch into presentation mode, enable higher contrast, or ask your local AI to help you find the next step.

The app is an original project. It takes inspiration from the spatial workspace and presentation concepts in [barehands](https://github.com/jaredrhod/barehands), but does not reuse its code. This project is independently licensed under AGPL-3.0-or-later.

## Use the hosted app

After the first Pages deployment completes, open:

**https://domiciandeogratius67-hub.github.io/traford-airdesk/**

GitHub Pages serves the static interface. Your cards and chat history are stored in this browser only. The hosted page cannot reach Ollama on your computer by itself; to use AI chat, run the small local companion below. The board works without Ollama.

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
4. Open the hosted AirDesk and select **Settings → Check connection**. If your browser asks permission for the hosted page to communicate with a local device, allow it to use the companion. Chromium-based browsers may require this local-network permission.

You can also run AirDesk completely locally by opening `http://127.0.0.1:8765` after starting the companion.

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

The included [Pages workflow](.github/workflows/pages.yml) deploys the static app on every push to `main` and supports manual runs. In the repository, open **Settings → Pages** and select **GitHub Actions** as the build and deployment source. The workflow uses GitHub's Pages artifact and deployment actions; it does not use Jekyll or a separate `gh-pages` branch. Check **Actions → Deploy AirDesk to GitHub Pages** for the deployment URL and status.

For a fork, update the Pages URL in `companion/server.py`'s `ALLOWED_ORIGINS` to the fork owner's `https://<owner>.github.io` origin before deploying, then push that change. A repository path does not change the origin.

## A note on the original inspiration

AirDesk is a new implementation, not a fork or code port. The spatial cards, a presentation view, and conversational interaction are broad product ideas that informed the direction. See [barehands](https://github.com/jaredrhod/barehands) for the independent project that sparked this exploration.

## License

Copyright © 2026 Traford.

This project is licensed under the GNU Affero General Public License, version 3 or (at your option) any later version. See [`LICENSE`](LICENSE) and the [official license text](https://www.gnu.org/licenses/agpl-3.0.txt).
