// Stand-in for WGLMakie's real bundle: records what mountWebGL passed it so the test can
// assert on setup_scene_init's arguments without needing three.js or a real WebGL context.
export let lastCall = null

export function setup_scene_init(...args) {
    lastCall = args
    return { done: true }
}
