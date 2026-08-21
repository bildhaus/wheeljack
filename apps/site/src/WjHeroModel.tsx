import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

gsap.registerPlugin(ScrollTrigger);

function smoothstep(value: number) {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

export default function WjHeroModel({ animated }: { animated: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || window.matchMedia("(max-width: 580px)").matches) return;

    let renderer: THREE.WebGLRenderer;

    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "high-performance" });
    } catch {
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.append(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(25, 1, 0.1, 100);
    camera.position.set(0, 0.55, 6.4);
    camera.lookAt(0, 0.5, 0);

    scene.add(new THREE.HemisphereLight(0xf7f4ec, 0x16150f, 2.4));

    const keyLight = new THREE.DirectionalLight(0xf7f4ec, 4.8);
    keyLight.position.set(3, 4, 4);
    scene.add(keyLight);

    const orangeLight = new THREE.DirectionalLight(0xd94f2b, 3.2);
    orangeLight.position.set(-3, 0.5, 2);
    scene.add(orangeLight);

    const modelGroup = new THREE.Group();
    modelGroup.rotation.set(-0.04, -0.42, 0.025);
    scene.add(modelGroup);

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const hero = host.closest<HTMLElement>(".hero");
    const sequence = host.closest<HTMLElement>(".hero-sequence");
    const scrollState = {
      progress: 0,
      travelProgress: 0,
      travelDistance: Math.max((sequence?.offsetHeight ?? 0) - window.innerHeight * 0.62, 0),
    };
    const scrollTrigger = animated && hero
      ? ScrollTrigger.create({
          trigger: hero,
          start: "top top",
          end: "bottom top",
          onUpdate: ({ progress }) => { scrollState.progress = progress; },
        })
      : null;
    const travelTrigger = animated && sequence
      ? ScrollTrigger.create({
          trigger: sequence,
          start: "top top",
          end: "bottom top",
          onUpdate: ({ progress }) => { scrollState.travelProgress = progress; },
          onRefresh: ({ start, end }) => {
            scrollState.travelDistance = Math.max(end - start - window.innerHeight * 0.62, 0);
          },
        })
      : null;

    const ditherTime = { value: 0 };
    const material = new THREE.MeshStandardMaterial({
      color: 0xc2c1bc,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.ditherTime = ditherTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          varying vec3 vDitherPosition;`,
        )
        .replace(
          "#include <project_vertex>",
          `vDitherPosition = transformed;
          #include <project_vertex>`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform float ditherTime;
          varying vec3 vDitherPosition;

          float randomCell(vec3 cell) {
            vec3 value = fract(cell * 0.1031);
            value += dot(value, value.yzx + 33.33);
            return fract((value.x + value.y) * value.z);
          }`,
        )
        .replace(
          "#include <opaque_fragment>",
          `float ditherLuminance = clamp(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
          vec3 ditherCell = floor(vDitherPosition * 48.0);
          float ditherSeed = ditherTime * 0.08;
          float ditherSeedIndex = floor(ditherSeed);
          float ditherSeedMix = smoothstep(0.0, 1.0, fract(ditherSeed));
          vec3 ditherSeedOffset = vec3(37.0, 17.0, 29.0);
          float ditherThreshold = mix(
            randomCell(ditherCell + ditherSeedOffset * ditherSeedIndex),
            randomCell(ditherCell + ditherSeedOffset * (ditherSeedIndex + 1.0)),
            ditherSeedMix
          );
          vec3 darkInk = vec3(0.0);
          vec3 lightInk = vec3(1.0);
          outgoingLight = mix(darkInk, lightInk, step(ditherThreshold, ditherLuminance));
          #include <opaque_fragment>`,
        );
    };
    material.customProgramCacheKey = () => "wheeljack-object-dither-v1";

    let animationFrame = 0;
    let mixer: THREE.AnimationMixer | null = null;
    let idleClip: THREE.AnimationClip | null = null;
    let idleAction: THREE.AnimationAction | null = null;
    let transformClip: THREE.AnimationClip | null = null;
    let transformAction: THREE.AnimationAction | null = null;
    let model: THREE.Group | null = null;
    let disposed = false;

    const render = (time: number) => {
      if (disposed) return;

      const progress = scrollState.progress;
      const transformProgress = smoothstep((progress - 0.12) / 0.7);
      if (mixer && idleClip && idleAction && transformClip && transformAction) {
        const transformWeight = smoothstep((progress - 0.06) / 0.12);
        idleAction.time = (time * 0.001) % idleClip.duration;
        idleAction.setEffectiveWeight(1 - transformWeight);
        transformAction.time = transformClip.duration * transformProgress;
        transformAction.setEffectiveWeight(transformWeight);
        mixer.update(0);
      }

      modelGroup.rotation.y = -0.42 + progress * 0.72 + Math.sin(time * 0.00022) * 0.035;
      modelGroup.rotation.x = -0.04 + Math.sin(time * 0.00016) * 0.018;
      modelGroup.position.y = transformProgress * 0.08;
      host.style.transform = `translate3d(0, ${scrollState.travelProgress * scrollState.travelDistance}px, 0)`;
      ditherTime.value = time * 0.001;
      renderer.render(scene, camera);

      if (animated) animationFrame = requestAnimationFrame(render);
    };

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      "/models/wheeljack-web.glb",
      (gltf) => {
        if (disposed) return;

        model = gltf.scene;
        model.position.set(0.14, -0.72, 0);
        model.traverse((object) => {
          if (object instanceof THREE.Mesh) object.material = material;
        });
        modelGroup.add(model);

        idleClip = THREE.AnimationClip.findByName(gltf.animations, "MapIdle") ?? null;
        transformClip = THREE.AnimationClip.findByName(gltf.animations, "MapTransformToAlt") ?? null;
        if (idleClip && transformClip) {
          mixer = new THREE.AnimationMixer(model);
          idleAction = mixer.clipAction(idleClip);
          idleAction.setLoop(THREE.LoopRepeat, Infinity).play();
          transformAction = mixer.clipAction(transformClip);
          transformAction.setLoop(THREE.LoopOnce, 1);
          transformAction.clampWhenFinished = true;
          transformAction.play();
          mixer.update(0);
        }

        setReady(true);
        render(performance.now());
      },
      undefined,
      () => setReady(false),
    );

    return () => {
      disposed = true;
      setReady(false);
      cancelAnimationFrame(animationFrame);
      scrollTrigger?.kill();
      travelTrigger?.kill();
      resizeObserver.disconnect();
      mixer?.stopAllAction();

      const geometries = new Set<THREE.BufferGeometry>();
      model?.traverse((object) => {
        if (object instanceof THREE.Mesh) geometries.add(object.geometry);
      });
      geometries.forEach((geometry) => geometry.dispose());
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      host.style.transform = "";
    };
  }, [animated]);

  return <div className={`hero-model${ready ? " ready" : ""}`} ref={hostRef} aria-hidden="true" />;
}
