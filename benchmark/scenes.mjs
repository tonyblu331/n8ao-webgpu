import * as THREE from "three";

/**
 * Scene definitions for N8AO benchmark.
 * Each factory returns: { scene, camera, update(dt) }
 */

export async function setupHelmet() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  const camera = new THREE.PerspectiveCamera(45, 1920 / 1080, 0.1, 100);
  camera.position.set(0, 0.15, 2.2);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(2, 3, 2);
  scene.add(dirLight);

  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync("/benchmark/assets/DamagedHelmet.glb");
  scene.add(gltf.scene);

  return {
    scene,
    camera,
    update() {},
  };
}

export async function setupInterior() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);

  const camera = new THREE.PerspectiveCamera(60, 1920 / 1080, 0.1, 100);
  camera.position.set(2, 1.6, 2);
  camera.lookAt(-1, 0.8, -1);

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(3, 5, 2);
  scene.add(dirLight);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.9 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7 });
  const sphereMat = new THREE.MeshStandardMaterial({ color: 0x4466aa, roughness: 0.3, metalness: 0.5 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), wallMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 3;
  scene.add(ceiling);

  for (let i = 0; i < 3; i++) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), wallMat);
    if (i === 0) wall.position.set(0, 1.5, -3);
    else wall.position.set(i === 1 ? -3 : 3, 1.5, 0);
    if (i > 0) wall.rotation.y = (i === 1 ? 1 : -1) * Math.PI / 2;
    scene.add(wall);
  }

  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.8), woodMat);
  tableTop.position.set(0, 0.75, 0);
  scene.add(tableTop);

  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.75), woodMat);
    leg.position.set((i % 2 === 0 ? -1 : 1) * 0.65, 0.375, (i < 2 ? -1 : 1) * 0.35);
    scene.add(leg);
  }

  for (let i = 0; i < 3; i++) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.08, 32, 32), sphereMat);
    sphere.position.set(-0.3 + i * 0.3, 0.83, 0);
    scene.add(sphere);
  }

  return {
    scene,
    camera,
    update() {},
  };
}
