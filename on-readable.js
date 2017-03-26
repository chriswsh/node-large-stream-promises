/* First try - using `readable` event and a generator
 * The code has not been tested, here to give the general idea, before I forget
 * Need to write these things down, very important */

const MAX_BATCH = 50; // how many promises/API calls are queued at once

let JSONStream = ... // I live in the outer closure, so I'm available to all functions in this context

// I am a generator that pauses after every so many promises are created
let convertJSONtoGeoCodes = function*() {
	try {

		let counter = 0; // counts how many promises have been created
		let promiseArray = []; // array to hold promises

		// loop while we still have data
		while ((chunk = JSONStream.read()) !== null) {

			counter++; // increment batch counter

			// Add to the promise array
            let p = new Promise((resolve, reject) => {
				// Do stuff, including declare local vars
				let var1 = chunk.data1;
				let var2 = chunk.data2;

				// Do the API call here
				let geoCodeValue = geoCodeStuff();

				// Now, resolve or reject based on the result
				// Pseudocode skeleton
				if (success) {
					resolve(geoCodeValue);
				}
				else {
					reject(error);
				}

				// explicitly set variable references to null to encourage garbage collection in large datasets
				// for best results, only do with variables in innermost closure
				geoCodeValue = null;
				var1 = null;
				var2 = null;
			});

			promiseArray.push(p
			.then(data => ({geoCode: data})) // Add all geocodes to an object - will be aggregated by Promise.all
			.catch(e => ({error: e}))); // Add all error to an object - will be aggregated by Promise.all
			// This also guarantees that the promise chain will always resolve successfully
			// shout-out to pipakin for doing this in courtbot-engine 
			
			// If a batch is finished...
			if (counter === MAX_BATCH) {
				// ...pause here while we wait for the promises to finish. I will yield an array of the objects of {geoCode: data} and {error: e}
				// and wait for next() to be called, after which...
				yield Promise.all(promiseArray);
				
				// ...I reset the counter and promise array, maybe nulling them first to encourage garbage collection (may not be required)
				counter = 0;
				promiseArray = [];
			}

            p = null;
		}
		// return, not yield, if we're at the end of the input stream
		return Promise.all(promiseArray); 
	}
	catch (err) {
		return Promise.reject(err); // return a rejected promise if we have failed code that's not otherwise caught
	}
}

// I run a generator with until it is finished - https://www.promisejs.org/generators/
function async(generator) {
	return function() {
		var g = generator(); // no this context or arguments to worry about

		// result contains what the generator yields
		function handle(result) {

			// It should always be a Promise.all, so we put the data processing in the then() to wait for it to finish
			return Promise.resolve(result.value)
			.then((resultValue) => {
				// consolidate the result array - shout-out to pipakin for doing this in courtbot-engine 
				let batch = resultValue.reduce((aggregate, item) => {
					item.error ? aggregate.errors.push(item.error) : aggregate.geoCodes.push(item.geoCode);
				}, { geoCodes: [], errors: [] });

				// write the processBatch function elsewhere, or put the code inline
				// this will run synchronously, so in effect it waits until a batch is finished before starting the next one
				processBatch(batch);
				
				// null out to encourage garbage collection for large datasets, might not be needed
				batch = null;
				resultValue = null;

				// if this is the last batch, stop the recursion...
				if (result.done) return Promise.resolve();

				// ...otherwise, after the processBatch function finishes (synchronously), we ask the generator to run the next batch
				return handle(g.next());
			}).catch(err => g.throw(err)); // Maybe add error handling later

		// The first time I am called, I run until first yield, and pass the results--in this case a Promise.all()--to handle()
		try {
			return handle(g.next());
		}
		catch (err) {
			return Promise.reject(err);
		}

	}
}

// Trigger on a readable stream, but we will read, in the generator, one chunk at a time so we can run geocode requests in batches
// Thus, there is no `data` event handler - NOT RECOMMENDED
JSONStream.on(`readable`, () => {
	let stuffDoer = async(convertJSONtoGeoCodes()); // assign the wrapper function to a local var

	// run the stuff!
	stuffDoer().then(() => {}).catch((err) => {}); // Maybe add error handling later
});