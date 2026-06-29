import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

function FloatingCore() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = state.clock.elapsedTime * 0.2;
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.3;
    }
  });

  return (
    <Float speed={2} rotationIntensity={1} floatIntensity={2}>
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[1.5, 0]} />
        <meshPhysicalMaterial 
          color="#3ECF8E"
          emissive="#3ECF8E"
          emissiveIntensity={0.5}
          wireframe
          transparent
          opacity={0.8}
        />
      </mesh>
      
      {/* Inner glowing 3D Envelope */}
      <group scale={0.8}>
        {/* Envelope Base */}
        <mesh position={[0, -0.2, 0]}>
          <boxGeometry args={[1.6, 1.1, 0.2]} />
          <meshPhysicalMaterial 
            color="#2481cc" 
            emissive="#2481cc" 
            emissiveIntensity={0.8} 
            roughness={0.2}
            metalness={0.8}
          />
        </mesh>
        
        {/* Envelope Flap (Triangular prism) */}
        <mesh position={[0, 0.35, 0.1]} rotation={[Math.PI / 2, Math.PI, 0]}>
          <cylinderGeometry args={[0.92, 0.92, 0.05, 3]} />
          <meshPhysicalMaterial 
            color="#3ECF8E" 
            emissive="#3ECF8E" 
            emissiveIntensity={0.5} 
            roughness={0.2}
          />
        </mesh>
      </group>
    </Float>
  );
}

export function Hero3D() {
  return (
    <div style={{ height: '400px', width: '100%', position: 'relative' }}>
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <FloatingCore />
        <Environment preset="city" />
        <ContactShadows position={[0, -2, 0]} opacity={0.4} scale={10} blur={2} far={4} />
      </Canvas>
    </div>
  );
}
