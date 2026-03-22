import { Stars } from "@/components/Stars";
import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { ProductShowcase } from "@/components/ProductShowcase";
import { Stats } from "@/components/Stats";
import { Features } from "@/components/Features";
import { HowItWorks } from "@/components/HowItWorks";
import { Security } from "@/components/Security";
import { Download } from "@/components/Download";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <>
      {/* Fixed starfield — visible across all sections */}
      <Stars />

      <main className="relative z-10">
        <Nav />
        <Hero />
        <ProductShowcase />
        <Stats />
        <Features />
        <HowItWorks />
        <Security />
        <Download />
        <Footer />
      </main>
    </>
  );
}
