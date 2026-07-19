export function initOrb() {
    const canvas = document.getElementById('profile-orb-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    let particles = [];
    const sphereRadius = 120;
    const numToAddEachFrame = 12;

    const r = 112, g = 255, b = 140;
    const rgbString = `rgba(${r},${g},${b},`;

    class Particle {
        constructor(x, y, z, vx, vy, vz) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.vx = vx;
            this.vy = vy;
            this.vz = vz;
            this.age = 0;
            this.stuckTime = 90 + Math.random() * 20;
            this.alpha = 0;
        }

        update() {
            this.age++;

            if (this.age > this.stuckTime) {
                this.vx += (Math.random() - 0.5) * 0.2;
                this.vy += (Math.random() - 0.5) * 0.2;
                this.vz += (Math.random() - 0.5) * 0.2;
                this.x += this.vx;
                this.y += this.vy;
                this.z += this.vz;
            }

            if (this.age < 50) {
                this.alpha = this.age / 50;
            } else if (this.age > 150) {
                this.alpha = Math.max(0, 1 - (this.age - 150) / 50);
            } else {
                this.alpha = 1;
            }
        }

        isDead() {
            return this.age > 200;
        }
    }

    function generateParticles() {
        for (let i = 0; i < numToAddEachFrame; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 2 - 1);
            const x = sphereRadius * Math.sin(phi) * Math.cos(theta);
            const y = sphereRadius * Math.sin(phi) * Math.sin(theta);
            const z = sphereRadius * Math.cos(phi);
            const vMult = 0.002;
            particles.push(new Particle(x, y, z, vMult * x, vMult * y, vMult * z));
        }
    }

    for (let i = 0; i < 200; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1);
        const x = sphereRadius * Math.sin(phi) * Math.cos(theta);
        const y = sphereRadius * Math.sin(phi) * Math.sin(theta);
        const z = sphereRadius * Math.cos(phi);
        particles.push(new Particle(x, y, z, 0.001 * x, 0.001 * y, 0.001 * z));
    }

    let angleY = 0;
    let angleX = 0;
    let frameCount = 0;

    function rotatePoint(px, py, pz, angY, angX) {
        const cosY = Math.cos(angY), sinY = Math.sin(angY);
        let x1 = cosY * px + sinY * pz;
        let z1 = -sinY * px + cosY * pz;
        let y1 = py;

        const cosX = Math.cos(angX), sinX = Math.sin(angX);
        let y2 = cosX * y1 - sinX * z1;
        let z2 = sinX * y1 + cosX * z1;
        let x2 = x1;

        return { x: x2, y: y2, z: z2 };
    }

    function animate() {
        ctx.clearRect(0, 0, width, height);

        angleY += 0.005;
        angleX = Math.sin(frameCount * 0.01) * 0.3;
        frameCount++;

        if (frameCount % 2 === 0) {
            generateParticles();
        }

        const fLen = 320;
        const projCenterX = centerX;
        const projCenterY = centerY;

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.update();

            if (p.isDead()) {
                particles.splice(i, 1);
                continue;
            }

            const rotated = rotatePoint(p.x, p.y, p.z, angleY, angleX);
            const finalZ = rotated.z;

            const projScale = fLen / (fLen - finalZ);
            const projX = rotated.x * projScale + projCenterX;
            const projY = rotated.y * projScale + projCenterY;

            const depthAlpha = Math.max(0, Math.min(1, 1 - finalZ / -750));
            const finalAlpha = depthAlpha * p.alpha;

            const size = 1.2 * projScale;
            ctx.fillStyle = rgbString + (finalAlpha * 0.8) + ')';
            ctx.beginPath();
            ctx.arc(projX, projY, size, 0, Math.PI * 2);
            ctx.fill();

            const cDist = Math.hypot(projX - projCenterX, projY - projCenterY);
            const maxCDist = sphereRadius * projScale * 0.8;
            if (cDist < maxCDist) {
                const cAlpha = finalAlpha * (1 - cDist / maxCDist);
                ctx.beginPath();
                ctx.moveTo(projX, projY);
                ctx.lineTo(projCenterX, projCenterY);
                ctx.strokeStyle = rgbString + (cAlpha * 0.4) + ')';
                ctx.lineWidth = 0.3 * cAlpha;
                ctx.stroke();
            }

            for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
                const other = particles[j];
                const otherRotated = rotatePoint(other.x, other.y, other.z, angleY, angleX);
                const otherProjScale = fLen / (fLen - otherRotated.z);
                const otherProjX = otherRotated.x * otherProjScale + projCenterX;
                const otherProjY = otherRotated.y * otherProjScale + projCenterY;

                const pDist = Math.hypot(projX - otherProjX, projY - otherProjY);
                if (pDist < 80 && Math.abs(p.z - other.z) < 150) {
                    const lineAlpha = finalAlpha * (1 - pDist / 80);
                    ctx.beginPath();
                    ctx.moveTo(projX, projY);
                    ctx.lineTo(otherProjX, otherProjY);
                    ctx.strokeStyle = rgbString + (lineAlpha * 0.4) + ')';
                    ctx.lineWidth = 0.4 * lineAlpha;
                    ctx.stroke();
                }
            }
        }

        ctx.fillStyle = rgbString + '0.8)';
        ctx.beginPath();
        ctx.arc(projCenterX, projCenterY, 3, 0, Math.PI * 2);
        ctx.fill();

        requestAnimationFrame(animate);
    }

    animate();
}
