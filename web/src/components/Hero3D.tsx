import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Environment, ContactShadows, Html } from '@react-three/drei';
import * as THREE from 'three';
import { Mail, ArrowRight, Send } from 'lucide-react';

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
      {/* Floating Icons inside the sphere */}
      <group>
        <Html transform position={[0, 0, 0]} scale={0.6}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '24px', 
            background: 'rgba(255, 255, 255, 0.8)', 
            backdropFilter: 'blur(12px)', 
            padding: '24px 40px', 
            borderRadius: '24px', 
            border: '1px solid rgba(255,255,255,1)', 
            boxShadow: '0 20px 40px rgba(0,0,0,0.1)'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <div style={{ background: '#f1f5f9', padding: '16px', borderRadius: '50%' }}>
                <Mail size={48} color="#10b981" />
              </div>
              <span style={{ fontWeight: 600, color: '#64748b' }}>Email</span>
            </div>
            
            <ArrowRight size={32} color="#94a3b8" />
            
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <div style={{ background: '#f1f5f9', padding: '16px', borderRadius: '50%' }}>
                <Send size={48} color="#3b82f6" />
              </div>
              <span style={{ fontWeight: 600, color: '#64748b' }}>Telegram</span>
            </div>
          </div>
        </Html>
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
