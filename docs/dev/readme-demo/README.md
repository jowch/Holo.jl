# README demo GIF

Source for `docs/src/assets/demo.gif`: a real Pluto session, driven by Playwright, showing
hover tooltips, a click, and the `@bind` round-trip on a CairoMakie scatter.

Prerequisites: Julia with Pluto in the default env, the `masque-dev` env (or let the
notebook build a temp env), Playwright installed in `test/e2e` (`npm install` there), and
`ffmpeg`, `ffprobe`, and `python3` on PATH for the assembly step.

1. Start Pluto with the dev env (see `test/e2e/serve.jl` for the same flags):
   ```sh
   MASQUE_DEV_ENV=~/.julia/environments/masque-dev \
     julia -e 'using Pluto; Pluto.run(; port=1250, launch_browser=false, require_secret_for_open_links=false, require_secret_for_access=false, disable_writing_notebook_files=true)'
   ```
   Poll `curl localhost:1250` for 200; don't grep the log.
2. Record frames (from `test/e2e`, where Playwright is installed):
   ```sh
   node ../../docs/dev/readme-demo/record.mjs http://localhost:1250 "$PWD/../../docs/dev/readme-demo/notebook.jl" /tmp/demo-frames
   ```
   The script opens a throwaway copy of the notebook so Pluto starts a fresh kernel; reusing
   the same path would inherit the previous run's `@bind` value.
3. Assemble:
   ```sh
   docs/dev/readme-demo/assemble.sh /tmp/demo-frames docs/src/assets/demo.gif
   ```
