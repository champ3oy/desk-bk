import { Test, TestingModule } from '@nestjs/testing';
import { ScraperService } from '../src/training/scraper.service';
import { Logger } from '@nestjs/common';

async function testScraper() {
  const module: TestingModule = await Test.createTestingModule({
    providers: [ScraperService],
  }).compile();

  const scraperService = module.get<ScraperService>(ScraperService);
  const targetUrl = 'https://blackstargroup.ai';

  console.log(`\n--- Testing Scraper for: ${targetUrl} ---\n`);

  const startTime = Date.now();
  try {
    const results = await scraperService.scanWebsite(targetUrl, 5, 3);
    const duration = (Date.now() - startTime) / 1000;

    console.log(
      `\nSuccessfully scanned ${results.length} pages in ${duration.toFixed(2)}s`,
    );
    results.forEach((res, i) => {
      console.log(
        `[${i + 1}] ${res.status === 200 ? '✅' : '❌'} ${res.url} - ${res.title}`,
      );
    });
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await scraperService.onModuleDestroy();
  }
}

testScraper();
