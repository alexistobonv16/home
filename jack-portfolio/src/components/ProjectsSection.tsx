import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import FadeIn from './FadeIn'
import LiveProjectButton from './LiveProjectButton'

interface Project {
  num: string
  category: string
  name: string
  description: string
  url: string
  tags: string[]
  col1: [string, string]
  col2: string
}

const projects: Project[] = [
  {
    num: '01',
    category: 'Medio Digital',
    name: 'NotiTec',
    description: 'Portal digital de noticias, análisis y divulgación sobre ciencia, tecnología e inteligencia artificial.',
    url: 'https://www.notitec.co',
    tags: ['Astro', 'SEO', 'Vercel'],
    col1: [
      'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260412_055344_5eff02e0-87a5-41ce-b64f-eb08da8f33db.png&w=1280&q=85',
      'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260412_055431_11d841fd-8b41-46a5-82e4-b04f2407a7d8.png&w=1280&q=85',
    ],
    col2: 'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260412_055451_e317bf2d-28d4-48cc-86b0-6f72f25b6327.png&w=1280&q=85',
  },
  {
    num: '02',
    category: 'Finanzas & PWA',
    name: 'Mis Gastos',
    description: 'Aplicación web progresiva para finanzas personales y control de presupuestos con funcionamiento offline.',
    url: 'https://gastos.alexistobon.com',
    tags: ['React', 'Vite', 'Tailwind', 'Cloudflare'],
    col1: [
      'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260412_055654_911201c5-36d9-4bc6-bac7-331adfce159f.png&w=1280&q=85',
      'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260412_055723_5ceda0b8-d9c2-4665-b2e3-83ba19ba76d1.png&w=1280&q=85',
    ],
    col2: 'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260412_055753_adc5dcbd-a8e6-49c0-b43a-9b030d835cea.png&w=1280&q=85',
  },
]

function ProjectCard({ project, index, totalCards }: { project: Project; index: number; totalCards: number }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: cardRef,
    offset: ['start end', 'end start'],
  })

  const targetScale = 1 - (totalCards - 1 - index) * 0.03
  const scale = useTransform(scrollYProgress, [0, 1], [1, targetScale])

  return (
    <div ref={cardRef} className="h-[85vh] sticky top-24 md:top-32" style={{ top: `${24 + index * 28}px` }}>
      <motion.div
        className="rounded-[40px] sm:rounded-[50px] md:rounded-[60px] border-2 border-[#D7E2EA] bg-[#0C0C0C] p-4 sm:p-6 md:p-8 h-full flex flex-col"
        style={{ scale, transformOrigin: 'top center' }}
      >
        {/* Fila superior */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4 sm:mb-6">
          <div className="flex items-start gap-4 sm:gap-6 md:gap-8">
            <span
              className="hero-heading font-black leading-none"
              style={{ fontSize: 'clamp(3rem, 10vw, 140px)' }}
            >
              {project.num}
            </span>
            <div className="flex flex-col gap-1 pt-2 sm:pt-4">
              <span className="text-[#D7E2EA] text-sm sm:text-base font-light uppercase tracking-wider opacity-60">
                {project.category}
              </span>
              <h3
                className="text-[#D7E2EA] font-medium uppercase"
                style={{ fontSize: 'clamp(1rem, 2.2vw, 2.1rem)' }}
              >
                {project.name}
              </h3>
              <p className="text-[#D7E2EA]/60 text-sm max-w-md hidden sm:block">
                {project.description}
              </p>
              <div className="flex gap-2 mt-1 flex-wrap">
                {project.tags.map((tag) => (
                  <span key={tag} className="text-[#D7E2EA]/50 text-xs border border-[#D7E2EA]/20 rounded-full px-3 py-1">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <LiveProjectButton href={project.url} />
        </div>

        {/* Grilla de imágenes */}
        <div className="flex gap-3 sm:gap-4 flex-1 min-h-0">
          {/* Columna izquierda - 40% */}
          <div className="w-[40%] flex flex-col gap-3 sm:gap-4">
            <img
              src={project.col1[0]}
              alt={`${project.name} vista 1`}
              className="w-full rounded-[40px] sm:rounded-[50px] md:rounded-[60px] object-cover"
              style={{ height: 'clamp(130px, 16vw, 230px)' }}
            />
            <img
              src={project.col1[1]}
              alt={`${project.name} vista 2`}
              className="w-full rounded-[40px] sm:rounded-[50px] md:rounded-[60px] object-cover flex-1"
              style={{ height: 'clamp(160px, 22vw, 340px)' }}
            />
          </div>
          {/* Columna derecha - 60% */}
          <div className="w-[60%]">
            <img
              src={project.col2}
              alt={`${project.name} principal`}
              className="w-full h-full rounded-[40px] sm:rounded-[50px] md:rounded-[60px] object-cover"
            />
          </div>
        </div>
      </motion.div>
    </div>
  )
}

export default function ProjectsSection() {
  return (
    <section id="proyectos" className="bg-[#0C0C0C] rounded-t-[40px] sm:rounded-t-[50px] md:rounded-t-[60px] -mt-10 sm:-mt-12 md:-mt-14 relative z-10 px-5 sm:px-8 md:px-10 py-20 sm:py-24 md:py-32">
      <FadeIn delay={0} y={40}>
        <h2
          className="hero-heading font-black uppercase text-center mb-16 sm:mb-20 md:mb-28"
          style={{ fontSize: 'clamp(3rem, 12vw, 160px)' }}
        >
          Proyectos
        </h2>
      </FadeIn>

      <div className="max-w-7xl mx-auto">
        {projects.map((project, i) => (
          <ProjectCard
            key={project.num}
            project={project}
            index={i}
            totalCards={projects.length}
          />
        ))}
      </div>
    </section>
  )
}
